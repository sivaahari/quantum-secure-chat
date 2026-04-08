// frontend/src/components/EncryptionDemo.tsx
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input }  from "@/components/ui/input";
import { Label }  from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { encryptDemo, decryptDemo } from "@/lib/api";
import { shortenHex } from "@/lib/utils";
import { safeDecrypt } from "@/lib/aes";
import type { EncryptedPayload } from "@/types";

interface EncryptionDemoProps {
  roomId:  string;
  hasKey:  boolean;
  decrypt: (p: EncryptedPayload) => Promise<string>;
}

export function EncryptionDemo({ roomId, hasKey, decrypt }: EncryptionDemoProps) {
  const [plaintext,  setPlaintext]  = useState("Hello, Quantum World! 🔐");
  const [encrypted,  setEncrypted]  = useState<EncryptedPayload | null>(null);
  const [decrypted,  setDecrypted]  = useState("");
  const [tampered,   setTampered]   = useState("");
  const [loading,    setLoading]    = useState(false);
  const [step,       setStep]       = useState<"idle"|"encrypted"|"decrypted"|"tampered">("idle");

  // Step 1: Encrypt via server-side API
  const handleEncrypt = async () => {
    if (!hasKey || !plaintext) return;
    setLoading(true);
    try {
      const result = await encryptDemo(roomId, plaintext);
      setEncrypted(result.encrypted as unknown as EncryptedPayload);
      setDecrypted("");
      setTampered("");
      setStep("encrypted");
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Decrypt via browser-side Web Crypto
  const handleDecrypt = async () => {
    if (!encrypted) return;
    setLoading(true);
    try {
      const text = await decrypt(encrypted);
      setDecrypted(text);
      setStep("decrypted");
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Tamper with ciphertext → show authentication failure
  const handleTamper = async () => {
    if (!encrypted) return;
    setLoading(true);
    try {
      // Flip a byte in the ciphertext
      const ctBytes = atob(encrypted.ciphertext_b64);
      const arr     = new Uint8Array(ctBytes.length);
      for (let i = 0; i < ctBytes.length; i++) arr[i] = ctBytes.charCodeAt(i);
      arr[4] ^= 0xFF;  // corrupt byte at position 4
      const tamperedPayload: EncryptedPayload = {
        ...encrypted,
        ciphertext_b64: btoa(String.fromCharCode(...arr)),
      };
      const result = await decrypt(tamperedPayload);
      setTampered(result);
      setStep("tampered");
    } finally {
      setLoading(false);
    }
  };

  // Reset
  const handleReset = () => {
    setEncrypted(null);
    setDecrypted("");
    setTampered("");
    setStep("idle");
  };

  return (
    <div className="p-4 space-y-4 max-w-2xl mx-auto">
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            🔐 End-to-End Encryption Demo
          </CardTitle>
          <p className="text-xs text-slate-400 mt-1">
            Demonstrates the full encrypt → transmit → decrypt → tamper flow
            using the quantum-derived AES-256-GCM key.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hasKey && (
            <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-700/40">
              <p className="text-xs text-amber-400">
                ⚠ No quantum key active. Go to the Quantum Key tab to generate one.
              </p>
            </div>
          )}

          {/* Step 1: Input plaintext */}
          <div className="space-y-2">
            <Label className="text-xs text-slate-400 flex items-center gap-1">
              <span className="w-5 h-5 bg-primary/20 rounded text-primary text-center font-bold text-[10px] flex items-center justify-center">1</span>
              Plaintext message
            </Label>
            <div className="flex gap-2">
              <Input
                value={plaintext}
                onChange={(e) => { setPlaintext(e.target.value); handleReset(); }}
                placeholder="Enter any message…"
                className="bg-secondary/50 border-border text-sm"
                disabled={!hasKey}
              />
              <Button
                onClick={handleEncrypt}
                disabled={!hasKey || !plaintext || loading}
                size="sm"
                className="whitespace-nowrap"
              >
                🔒 Encrypt
              </Button>
            </div>
          </div>

          {/* Step 2: Show ciphertext */}
          {encrypted && (
            <>
              <Separator className="bg-border/50" />
              <div className="space-y-2">
                <Label className="text-xs text-slate-400 flex items-center gap-1">
                  <span className="w-5 h-5 bg-amber-500/20 rounded text-amber-400 text-center font-bold text-[10px] flex items-center justify-center">2</span>
                  Ciphertext (AES-256-GCM) — what travels over the network
                </Label>
                <div className="bg-black/40 rounded-lg p-3 space-y-2 font-mono text-[11px] border border-amber-900/30">
                  <div>
                    <span className="text-slate-500">nonce (96-bit):   </span>
                    <span className="text-amber-400">{encrypted.nonce_b64}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">ciphertext+tag:   </span>
                    <span className="text-emerald-400 break-all">{encrypted.ciphertext_b64}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">key version:      </span>
                    <span className="text-primary">v{encrypted.key_version}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">timestamp:        </span>
                    <span className="text-slate-400">{new Date(encrypted.timestamp * 1000).toISOString()}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleDecrypt} disabled={loading} size="sm" variant="outline" className="border-emerald-700/50 text-emerald-400">
                    🔓 Decrypt (browser)
                  </Button>
                  <Button onClick={handleTamper} disabled={loading} size="sm" variant="outline" className="border-red-700/50 text-red-400">
                    ☠ Tamper + Decrypt
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* Step 3: Decryption result */}
          {decrypted && (
            <>
              <Separator className="bg-border/50" />
              <div className="space-y-2">
                <Label className="text-xs text-slate-400 flex items-center gap-1">
                  <span className="w-5 h-5 bg-emerald-500/20 rounded text-emerald-400 text-center font-bold text-[10px] flex items-center justify-center">3</span>
                  Decrypted (Web Crypto AES-GCM)
                </Label>
                <div className="bg-emerald-950/30 border border-emerald-800/40 rounded-lg p-3">
                  <p className="text-emerald-300 text-sm">✅ {decrypted}</p>
                  <p className="text-[10px] text-emerald-700 mt-1">
                    Authentication tag verified — message is authentic and unmodified.
                  </p>
                </div>
              </div>
            </>
          )}

          {/* Tamper result */}
          {tampered && (
            <>
              <Separator className="bg-border/50" />
              <div className="space-y-2">
                <Label className="text-xs text-slate-400 flex items-center gap-1">
                  <span className="w-5 h-5 bg-red-500/20 rounded text-red-400 text-center font-bold text-[10px] flex items-center justify-center">!</span>
                  Tampered decryption result
                </Label>
                <div className="bg-red-950/30 border border-red-800/40 rounded-lg p-3">
                  <p className="text-red-300 text-sm font-mono">{tampered}</p>
                  <p className="text-[10px] text-red-700 mt-1">
                    The GCM authentication tag detected corruption — decryption
                    refused. This is AES-GCM's tamper-detection in action.
                  </p>
                </div>
              </div>
            </>
          )}

          {/* Explanation */}
          <Separator className="bg-border/50" />
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: "⚛", title: "BB84 QKD", desc: "Quantum channel generates shared secret via photon polarization" },
              { icon: "🔑", title: "HKDF-SHA256", desc: "Privacy amplification extracts 256 bits of cryptographic key material" },
              { icon: "🔒", title: "AES-256-GCM", desc: "Every message encrypted + authenticated. Key refreshes every 5 messages." },
            ].map(({ icon, title, desc }) => (
              <div key={title} className="text-center space-y-1 p-2 rounded-lg bg-secondary/30">
                <div className="text-xl">{icon}</div>
                <div className="text-xs font-semibold text-slate-300">{title}</div>
                <div className="text-[10px] text-slate-500">{desc}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}