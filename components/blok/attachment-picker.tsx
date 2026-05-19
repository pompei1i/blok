'use client';

import { Image, FileText, Film, Mic, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

interface AttachmentPickerProps {
  onAttach: (files: File[]) => void;
  onClose: () => void;
}

export function AttachmentPicker({ onAttach, onClose }: AttachmentPickerProps) {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const attachmentTypes = [
    { icon: Image,    label: t("attachment.image"),    accept: 'image/*',                   color: 'text-green-400' },
    { icon: Film,     label: t("attachment.video"),    accept: 'video/*',                   color: 'text-purple-400' },
    { icon: FileText, label: t("attachment.document"), accept: '.pdf,.doc,.docx,.txt',      color: 'text-blue-400' },
    { icon: Mic,      label: t("attachment.audio"),    accept: 'audio/*',                   color: 'text-yellow-400' },
  ];

  const handleTypeClick = (accept: string) => {
    if (fileInputRef.current) {
      fileInputRef.current.accept = accept;
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      onAttach(files);
      onClose();
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      onAttach(files);
      onClose();
    }
  };

  return (
    <div className="absolute bottom-full left-0 mb-2 w-72 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg shadow-xl overflow-hidden animate-slide-in">
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} multiple />

      <div className="flex items-center justify-between p-2 border-b border-[var(--border)]">
        <span className="text-xs text-[var(--text-muted)] uppercase tracking-wider">
          {t("attachment.attachFile")}
        </span>
        <button onClick={onClose} className="p-1 hover:bg-[var(--bg-hover)] rounded transition-colors text-[var(--text-muted)]">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        className={cn(
          'p-4 m-2 border-2 border-dashed rounded-lg transition-colors text-center',
          dragActive ? 'border-[var(--accent-red)] bg-[var(--accent-red)]/10' : 'border-[var(--border)]'
        )}
      >
        <Upload className="w-8 h-8 mx-auto mb-2 text-[var(--text-muted)]" />
        <p className="text-sm text-[var(--text-muted)]">{t("attachment.dragDrop")}</p>
        <p className="text-xs text-[var(--text-muted)] mt-1">{t("attachment.orChooseBelow")}</p>
      </div>

      <div className="grid grid-cols-4 gap-1 p-2 border-t border-[var(--border)]">
        {attachmentTypes.map(({ icon: Icon, label, accept, color }) => (
          <button
            key={label}
            onClick={() => handleTypeClick(accept)}
            className="flex flex-col items-center gap-1 p-2 hover:bg-[var(--bg-hover)] rounded-lg transition-colors"
          >
            <Icon className={cn('w-5 h-5', color)} />
            <span className="text-xs text-[var(--text-muted)]">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
