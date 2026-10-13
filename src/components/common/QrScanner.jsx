import { useEffect, useRef, useState } from 'react';

/** The camera, reading QR codes: calls onCode(text) for each code it sees. */
export default function QrScanner({ onCode }) {
  const video = useRef(null);
  const [error, setError] = useState('');
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    let stream = null;
    let frame = 0;
    let live = true;
    const canvas = document.createElement('canvas');
    const g = canvas.getContext('2d', { willReadFrequently: true });

    (async () => {
      try {
        const [{ default: jsQR }, media] = await Promise.all([
          import('jsqr'),
          navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }),
        ]);
        stream = media;
        if (!live) return stream.getTracks().forEach((t) => t.stop());
        video.current.srcObject = stream;
        await video.current.play().catch(() => {});
        const scan = () => {
          if (!live) return;
          const v = video.current;
          if (v?.videoWidth) {
            // Scaled down: quicker, and QR codes on a screen are big anyway.
            const scale = Math.min(1, 640 / v.videoWidth);
            canvas.width = Math.round(v.videoWidth * scale);
            canvas.height = Math.round(v.videoHeight * scale);
            g.drawImage(v, 0, 0, canvas.width, canvas.height);
            const code = jsQR(g.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
            if (code?.data) onCodeRef.current(code.data);
          }
          frame = requestAnimationFrame(scan);
        };
        scan();
      } catch (e) {
        if (live) setError(e?.name === 'NotAllowedError' ? 'Allow ChatApp to use the camera to scan the code.' : 'The camera isn’t available.');
      }
    })();

    return () => {
      live = false;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="qr-scanner">
      {error ? <p className="form-error">{error}</p> : <video ref={video} muted playsInline aria-label="Camera" />}
    </div>
  );
}
