import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

// Owns the camera feed and a continuous decode loop for kiosk mode's QR scanning.
// The camera stream is requested once and kept running for the component's whole
// lifetime (re-requesting it on every dialog open/close would be slow and flickery);
// `enabled` instead just gates whether decoded frames are actually reported, so
// KioskPage can "pause" scanning while a check-in/error dialog is on screen without
// tearing down the camera.
export function useQrScanner({ enabled, onDetect }: { enabled: boolean; onDetect: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Latest values without re-running the setup effect on every render/prop change.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;
  // So a code can be re-scanned (e.g. the same student again right after "Done")
  // once scanning resumes, rather than being permanently de-duped.
  const lastDetectedRef = useRef<string | null>(null);
  useEffect(() => {
    if (enabled) lastDetectedRef.current = null;
  }, [enabled]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let rafId: number;
    let cancelled = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    function tick() {
      const video = videoRef.current;
      if (video && ctx && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        if (enabledRef.current) {
          const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(frame.data, frame.width, frame.height);
          if (code && code.data && code.data !== lastDetectedRef.current) {
            lastDetectedRef.current = code.data;
            onDetectRef.current(code.data);
          }
        }
      }
      rafId = requestAnimationFrame(tick);
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play().catch(() => {});
        }
        rafId = requestAnimationFrame(tick);
      })
      .catch(() => setCameraError("Camera access is required for kiosk mode."));

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // Runs once for the component's lifetime — see comment above on `enabled`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { videoRef, cameraError };
}
