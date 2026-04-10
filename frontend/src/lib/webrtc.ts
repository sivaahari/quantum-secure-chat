// frontend/src/lib/webrtc.ts
/**
 * WebRTC connection manager for peer-to-peer BB84 key exchange.
 *
 * The server (Flask/SocketIO) is used ONLY for signaling:
 *   - SDP offer / answer exchange
 *   - ICE candidate relay
 *
 * All BB84 messages (qubit states, bases, QBER samples) travel
 * through the RTCDataChannel — the server never sees them.
 *
 * STUN servers: Google's public STUN — needed to traverse NAT.
 * For production, add your own TURN server for relay fallback.
 */

import { Socket } from "socket.io-client";

// ─── Types ────────────────────────────────────────────────────────────────────

export type P2PRole = "alice" | "bob";

export type P2PMessageType =
  | "bb84_qubits"       // Alice → Bob: encoded qubit states
  | "bb84_bob_bases"    // Bob → Alice: Bob's measurement bases
  | "bb84_alice_bases"  // Alice → Bob: Alice's bases (for sifting)
  | "bb84_qber_sample"  // Alice → Bob: sample bits for QBER check
  | "bb84_qber_result"  // Bob → Alice: QBER confirmation
  | "bb84_key_ready"    // Alice → Bob: key derivation complete (hash for verify)
  | "bb84_abort"        // either: abort key exchange
  | "chat_encrypted"    // encrypted chat message (future use)
  | "ping" | "pong";    // connection keep-alive

export interface P2PMessage {
  type:    P2PMessageType;
  payload: unknown;
  ts:      number;       // Unix ms timestamp
}

export type P2PMessageHandler = (msg: P2PMessage) => void;

export interface WebRTCConfig {
  socket:      Socket;
  roomId:      string;
  username:    string;
  role:        P2PRole;
  onMessage:   P2PMessageHandler;
  onConnected: () => void;
  onDisconnected: () => void;
  onError:     (err: string) => void;
}

// ─── ICE/STUN configuration ───────────────────────────────────────────────────

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],
  iceTransportPolicy: "all",
  bundlePolicy:       "max-bundle",
};

// ─── WebRTCManager ────────────────────────────────────────────────────────────

export class WebRTCManager {
  private pc:          RTCPeerConnection | null = null;
  private channel:     RTCDataChannel | null    = null;
  private cfg:         WebRTCConfig;
  private connected    = false;

  constructor(cfg: WebRTCConfig) {
    this.cfg = cfg;
    this._attachSignalHandlers();
  }

  // ── Attach SocketIO listeners for signaling ──────────────────────────────

  private _attachSignalHandlers() {
    const { socket } = this.cfg;

    socket.on("webrtc_offer", async (data: {
      sdp: RTCSessionDescriptionInit;
      from_username: string;
    }) => {
      console.log("[WebRTC] Received offer from", data.from_username);
      await this._handleOffer(data.sdp);
    });

    socket.on("webrtc_answer", async (data: {
      sdp: RTCSessionDescriptionInit;
      from_username: string;
    }) => {
      console.log("[WebRTC] Received answer from", data.from_username);
      await this.pc?.setRemoteDescription(new RTCSessionDescription(data.sdp));
    });

    socket.on("webrtc_ice", async (data: {
      candidate: RTCIceCandidateInit;
      from_username: string;
    }) => {
      try {
        await this.pc?.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (e) {
        // Benign: ICE candidate may arrive before remote description
      }
    });

    socket.on("webrtc_peer_ready", (data: { username: string }) => {
      console.log("[WebRTC] Peer ready:", data.username);
      // Alice initiates on peer ready (role=alice)
      if (this.cfg.role === "alice") {
        this.initiateConnection();
      }
    });
  }

  // ── Alice initiates ──────────────────────────────────────────────────────

  async initiateConnection() {
    console.log("[WebRTC] Alice initiating connection…");
    this._createPeerConnection();

    // Create the data channel (Alice always creates it)
    this.channel = this.pc!.createDataChannel("bb84", {
      ordered:          true,
      maxRetransmits:   10,
    });
    this._setupDataChannel(this.channel);

    const offer = await this.pc!.createOffer();
    await this.pc!.setLocalDescription(offer);

    this.cfg.socket.emit("webrtc_offer", {
      room_id:       this.cfg.roomId,
      sdp:           offer,
      from_username: this.cfg.username,
    });
  }

  // ── Bob receives offer ───────────────────────────────────────────────────

  private async _handleOffer(sdp: RTCSessionDescriptionInit) {
    this._createPeerConnection();

    // Bob receives the data channel
    this.pc!.ondatachannel = (event) => {
      this.channel = event.channel;
      this._setupDataChannel(this.channel);
    };

    await this.pc!.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await this.pc!.createAnswer();
    await this.pc!.setLocalDescription(answer);

    this.cfg.socket.emit("webrtc_answer", {
      room_id:       this.cfg.roomId,
      sdp:           answer,
      from_username: this.cfg.username,
    });
  }

  // ── Create RTCPeerConnection ─────────────────────────────────────────────

  private _createPeerConnection() {
    if (this.pc) return;

    this.pc = new RTCPeerConnection(RTC_CONFIG);

    // ICE candidates — send through signaling server
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.cfg.socket.emit("webrtc_ice", {
          room_id:       this.cfg.roomId,
          candidate:     event.candidate.toJSON(),
          from_username: this.cfg.username,
        });
      }
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc?.connectionState;
      console.log("[WebRTC] Connection state:", state);
      if (state === "connected") {
        this.connected = true;
        this.cfg.onConnected();
      } else if (state === "disconnected" || state === "failed" || state === "closed") {
        this.connected = false;
        this.cfg.onDisconnected();
      }
    };

    this.pc.onicegatheringstatechange = () => {
      console.log("[WebRTC] ICE gathering:", this.pc?.iceGatheringState);
    };
  }

  // ── DataChannel setup ────────────────────────────────────────────────────

  private _setupDataChannel(ch: RTCDataChannel) {
    ch.onopen = () => {
      console.log("[WebRTC] ✅ DataChannel open");
      this.connected = true;
      this.cfg.onConnected();
      // Keep-alive ping
      this._startPing();
    };

    ch.onclose = () => {
      console.log("[WebRTC] DataChannel closed");
      this.connected = false;
      this.cfg.onDisconnected();
    };

    ch.onerror = (err) => {
      console.error("[WebRTC] DataChannel error:", err);
      this.cfg.onError("DataChannel error");
    };

    ch.onmessage = (event) => {
      try {
        const msg: P2PMessage = JSON.parse(event.data);
        if (msg.type === "ping") {
          this.send("pong", {});
          return;
        }
        if (msg.type === "pong") return;
        this.cfg.onMessage(msg);
      } catch (e) {
        console.error("[WebRTC] Failed to parse message:", e);
      }
    };
  }

  // ── Send a typed message ─────────────────────────────────────────────────

  send(type: P2PMessageType, payload: unknown) {
    if (!this.channel || this.channel.readyState !== "open") {
      console.warn("[WebRTC] Cannot send — channel not open");
      return false;
    }
    const msg: P2PMessage = { type, payload, ts: Date.now() };
    this.channel.send(JSON.stringify(msg));
    return true;
  }

  // ── Keep-alive ───────────────────────────────────────────────────────────

  private _pingTimer: ReturnType<typeof setInterval> | null = null;

  private _startPing() {
    this._pingTimer = setInterval(() => {
      this.send("ping", {});
    }, 15_000);
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  destroy() {
    if (this._pingTimer) clearInterval(this._pingTimer);
    this.channel?.close();
    this.pc?.close();
    this.channel = null;
    this.pc      = null;
    this.connected = false;

    // Remove signaling listeners
    const { socket } = this.cfg;
    socket.off("webrtc_offer");
    socket.off("webrtc_answer");
    socket.off("webrtc_ice");
    socket.off("webrtc_peer_ready");
  }

  get isConnected() { return this.connected; }
}