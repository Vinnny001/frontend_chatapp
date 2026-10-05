import { useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import Modal from './Modal.jsx';

const OUTPUT = 640; // uploaded photo: 640 × 640
const MAX_ZOOM = 4;

/**
 * Choose which part of a photo shows in the round profile picture: drag to move it, pinch,
 * scroll or use the slider to zoom. `onDone(file)` gets the square crop as a JPEG.
 */
export default function AvatarCropper({ file, onCancel, onDone }) {
  const [img, setImg] = useState(null); // { el, w, h, url }
  const [frame, setFrame] = useState(() => Math.min(300, (typeof window !== 'undefined' ? window.innerWidth : 360) - 72));
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const pointers = useRef(new Map());
  const pinch = useRef(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => setImg({ el, w: el.naturalWidth, h: el.naturalHeight, url });
    el.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    const onResize = () => setFrame(Math.min(300, window.innerWidth - 72));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // "Cover" scale: at zoom 1 the photo just fills the square.
  const base = img ? Math.max(frame / img.w, frame / img.h) : 1;
  const size = (zoom) => (img ? { w: img.w * base * zoom, h: img.h * base * zoom } : { w: frame, h: frame });

  /** Keeps the photo covering the whole square (no empty edges). */
  const clamp = (v) => {
    const { w, h } = size(v.zoom);
    return { zoom: v.zoom, x: Math.min(0, Math.max(frame - w, v.x)), y: Math.min(0, Math.max(frame - h, v.y)) };
  };

  // Start centred.
  useEffect(() => {
    if (!img) return;
    const { w, h } = size(1);
    setView(clamp({ zoom: 1, x: (frame - w) / 2, y: (frame - h) / 2 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, frame]);

  /** Zoom around a point in the square (default: its centre). */
  const zoomTo = (zoom, cx = frame / 2, cy = frame / 2) =>
    setView((v) => {
      const z = Math.min(MAX_ZOOM, Math.max(1, zoom));
      const k = z / v.zoom;
      return clamp({ zoom: z, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k });
    });

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.zoom };
    }
  };
  const onPointerMove = (e) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      zoomTo((pinch.current.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.dist);
      return;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    setView((v) => clamp({ ...v, x: v.x + dx, y: v.y + dy }));
  };
  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };
  const onWheel = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    zoomTo(view.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top);
  };

  async function done() {
    if (!img) return;
    setBusy(true);
    const scale = base * view.zoom;
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img.el, -view.x / scale, -view.y / scale, frame / scale, frame / scale, 0, 0, OUTPUT, OUTPUT);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    const name = (file.name || 'photo').replace(/\.\w+$/, '') + '.jpg';
    onDone(new File([blob], name, { type: 'image/jpeg' }));
  }

  const { w, h } = size(view.zoom);
  return (
    <Modal
      title="Choose what shows"
      onClose={onCancel}
      className="cropper-modal"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={done} disabled={!img || busy}>
            {busy ? 'Saving…' : 'Use photo'}
          </button>
        </>
      }
    >
      <p className="hint">Drag to move the photo. Pinch, scroll or use the slider to zoom.</p>
      <div
        className="cropper"
        style={{ width: frame, height: frame }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        {img && (
          <img src={img.url} alt="" draggable="false" style={{ width: w, height: h, transform: `translate(${view.x}px, ${view.y}px)` }} />
        )}
        <span className="cropper-ring" />
      </div>
      <div className="cropper-zoom">
        <ZoomOut size={18} />
        <input
          type="range"
          min="1"
          max={MAX_ZOOM}
          step="0.01"
          value={view.zoom}
          onChange={(e) => zoomTo(Number(e.target.value))}
          aria-label="Zoom"
        />
        <ZoomIn size={18} />
      </div>
    </Modal>
  );
}
