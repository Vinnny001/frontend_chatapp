import { useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import Avatar from './Avatar.jsx';
import AvatarCropper from './AvatarCropper.jsx';
import { uploadFile } from '../../lib/api.js';
import { toast } from '../../store/ui.js';

export default function AvatarPicker({ url, name, group, onChange, size = 140, disabled = false }) {
  const input = useRef(null);
  const [progress, setProgress] = useState(null);
  const [cropping, setCropping] = useState(null); // the picked photo, before choosing the area

  function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('Please choose an image', 'error');
    setCropping(file);
  }

  async function upload(file) {
    setCropping(null);
    setProgress(0);
    try {
      const { url: uploaded } = await uploadFile(file, { onProgress: setProgress });
      await onChange(uploaded);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="avatar-picker" style={{ width: size, height: size }}>
      <Avatar name={name} url={url} size={size} group={group} />
      {!disabled && (
        <button type="button" className="avatar-picker-overlay" onClick={() => input.current?.click()} aria-label="Change photo">
          <Camera size={24} />
          <span>{progress != null ? `${Math.round(progress * 100)}%` : url ? 'Change photo' : 'Add photo'}</span>
        </button>
      )}
      <input ref={input} type="file" accept="image/*" hidden onChange={pick} />
      {cropping && <AvatarCropper file={cropping} onCancel={() => setCropping(null)} onDone={upload} />}
    </div>
  );
}
