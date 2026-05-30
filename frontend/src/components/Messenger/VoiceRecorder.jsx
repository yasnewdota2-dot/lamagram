import React, { useEffect, useRef, useState } from "react";
import { Mic, X, Check } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { formatDuration } from "../../lib/format";

// Lightweight MediaRecorder-based voice recorder that captures
// duration_sec + 40-sample waveform via AnalyserNode.
export const VoiceRecorder = ({ onSend, onCancel }) => {
  const { t } = useI18n();
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [level, setLevel] = useState(0);

  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const ctxRef = useRef(null);
  const analyserRef = useRef(null);
  const chunksRef = useRef([]);
  const samplesRef = useRef([]);
  const rafRef = useRef(null);
  const tickRef = useRef(null);
  const startTimeRef = useRef(0);
  const cancelledRef = useRef(false);
  const finishedRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!mounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        const ctx = new Ctx();
        ctxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyserRef.current = analyser;
        source.connect(analyser);

        const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm";
        const rec = new MediaRecorder(stream, { mimeType: mime });
        recorderRef.current = rec;
        rec.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
        };
        rec.start(200);
        startTimeRef.current = Date.now();

        // Sample audio level ~10x/sec
        const buf = new Uint8Array(analyser.frequencyBinCount);
        tickRef.current = setInterval(() => {
          analyser.getByteFrequencyData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i];
          const avg = sum / buf.length / 255;
          samplesRef.current.push(avg);
          setLevel(avg);
          setSeconds((Date.now() - startTimeRef.current) / 1000);
        }, 100);
      } catch (e) {
        setError(e.message || "mic_denied");
      }
    })();

    return () => {
      mounted = false;
      cleanup(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cleanup = (silent = false) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
    try {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
    } catch {/* ignore */}
    try {
      streamRef.current && streamRef.current.getTracks().forEach((tr) => tr.stop());
    } catch {/* ignore */}
    try {
      ctxRef.current && ctxRef.current.close();
    } catch {/* ignore */}
  };

  const downsample = (arr, n) => {
    if (arr.length === 0) return new Array(n).fill(0);
    if (arr.length <= n) {
      const out = arr.slice();
      while (out.length < n) out.push(0);
      return out;
    }
    const out = new Array(n).fill(0);
    const bucket = arr.length / n;
    for (let i = 0; i < n; i++) {
      const start = Math.floor(i * bucket);
      const end = Math.floor((i + 1) * bucket);
      let max = 0;
      for (let j = start; j < end; j++) if (arr[j] > max) max = arr[j];
      out[i] = max;
    }
    return out;
  };

  const cancel = () => {
    cancelledRef.current = true;
    cleanup();
    onCancel?.();
  };

  const finish = async () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const rec = recorderRef.current;
    if (!rec) {
      onCancel?.();
      return;
    }
    const duration = Math.max(0.1, (Date.now() - startTimeRef.current) / 1000);
    const samples = downsample(samplesRef.current, 40);

    await new Promise((resolve) => {
      rec.onstop = () => resolve();
      if (rec.state !== "inactive") {
        try { rec.stop(); } catch { resolve(); }
      } else {
        resolve();
      }
    });

    const mime = rec.mimeType || "audio/webm";
    const blob = new Blob(chunksRef.current, { type: mime });
    cleanup();
    if (!cancelledRef.current && blob.size > 0) {
      const ext = mime.includes("ogg") ? "ogg" : "webm";
      const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: mime });
      onSend?.(file, { duration_sec: duration, waveform: samples });
    } else {
      onCancel?.();
    }
  };

  if (error) {
    return (
      <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-2xl"
        style={{ background: "rgba(255,80,80,0.08)", border: "1px solid rgba(255,80,80,0.25)" }}
        data-testid="voice-error">
        <span className="text-sm text-[#FFB4B4]">{t("micDenied")}</span>
        <button onClick={cancel} className="gm-btn-ghost text-xs">
          <X className="w-4 h-4" /> {t("cancel")}
        </button>
      </div>
    );
  }

  const pulse = Math.min(1, level * 1.8);
  return (
    <div
      className="flex items-center gap-3 px-3 py-2 rounded-2xl"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)" }}
      data-testid="voice-recorder"
    >
      <span
        className="w-3 h-3 rounded-full shrink-0"
        style={{
          background: "#FF5577",
          boxShadow: `0 0 ${8 + pulse * 18}px rgba(255,85,119,${0.6 + pulse * 0.4})`,
          transition: "box-shadow 80ms linear",
        }}
        data-testid="voice-recording-dot"
      />
      <span className="text-sm text-white font-medium">{t("recording")}</span>
      <span className="text-sm text-white/70 tabular-nums" data-testid="voice-recording-timer">
        {formatDuration(seconds)}
      </span>
      <div className="flex-1" />
      <button
        onClick={cancel}
        className="w-9 h-9 rounded-full flex items-center justify-center"
        style={{ background: "rgba(255,80,80,0.16)", border: "1px solid rgba(255,80,80,0.32)", color: "#FFB4B4" }}
        aria-label="cancel voice"
        data-testid="voice-cancel-button"
      >
        <X className="w-4 h-4" />
      </button>
      <button
        onClick={finish}
        className="w-9 h-9 rounded-full flex items-center justify-center text-white"
        style={{ background: "linear-gradient(135deg,#3B9EFF,#A78BFA)" }}
        aria-label="send voice"
        data-testid="voice-send-button"
      >
        <Check className="w-4 h-4" />
      </button>
    </div>
  );
};
