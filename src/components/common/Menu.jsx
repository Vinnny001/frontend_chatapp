import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Floating context menu positioned at (x, y), kept inside the viewport. Rendered into
 * <body> because ancestors with backdrop-filter/transform would otherwise capture
 * position: fixed and push the menu off-screen.
 */
export default function Menu({ x, y, items, onClose, header }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Re-clamp whenever the menu's size changes too (e.g. items that arrive after a lookup).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const place = () => {
      const { width, height } = el.getBoundingClientRect();
      const next = {
        left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
        top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
      };
      setPos((cur) => (cur.left === next.left && cur.top === next.top ? cur : next));
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(el);
    return () => observer.disconnect();
  }, [x, y]);

  useEffect(() => {
    const close = (e) => !ref.current?.contains(e.target) && onClose();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return createPortal(
    <div className="menu" ref={ref} style={pos} role="menu">
      {header}
      {items.filter(Boolean).map((item) => (
        <button
          key={item.label}
          role="menuitem"
          className={`menu-item ${item.danger ? 'danger' : ''}`}
          onClick={() => {
            onClose();
            item.onClick();
          }}
        >
          {item.icon && <item.icon size={18} />}
          <span>{item.label}</span>
        </button>
      ))}
    </div>,
    document.body
  );
}

/** Opens a menu from a click/contextmenu event or a long press on touch devices. */
export function useContextMenu() {
  const [menu, setMenu] = useState(null);
  const timer = useRef(null);
  const firedAt = useRef(0);

  const open = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const point = e.touches?.[0] || e;
    setMenu({ x: point.clientX, y: point.clientY });
  };

  const longPress = {
    onTouchStart: (e) => {
      const touch = e.touches[0];
      timer.current = setTimeout(() => {
        firedAt.current = Date.now();
        navigator.vibrate?.(15);
        setMenu({ x: touch.clientX, y: touch.clientY });
      }, 450);
    },
    onTouchEnd: () => clearTimeout(timer.current),
    onTouchMove: () => clearTimeout(timer.current),
    // The finger lifting after a long press must not also count as a tap.
    onClickCapture: (e) => {
      if (Date.now() - firedAt.current < 800) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
  };

  return { menu, open, close: () => setMenu(null), longPress };
}
