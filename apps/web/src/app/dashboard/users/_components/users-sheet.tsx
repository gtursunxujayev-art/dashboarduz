'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { IconX } from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';

/** Right-side sheet for the users page forms. Closes on Escape, on the backdrop and on the close buttons. */
export function UsersSheet({
  title,
  description,
  icon: SheetIcon,
  onClose,
  footer,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon: Icon;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div role="dialog" aria-modal="true" className="modal-panel max-w-[600px]">
        <div className="modal-header">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <SheetIcon className="h-5 w-5" stroke={1.6} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="modal-title truncate">{title}</h2>
              {description ? <p className="modal-description truncate">{description}</p> : null}
            </div>
            <button type="button" onClick={onClose} aria-label="Yopish" className="btn btn-ghost btn-icon btn-sm w-8">
              <IconX className="h-4 w-4" stroke={1.8} />
            </button>
          </div>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-footer">{footer}</div>
      </div>
    </div>
  );
}

/** One titled group inside a sheet: small caption, then the fields. */
export function SheetGroup({ caption, children }: { caption: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <p className="caption">{caption}</p>
      {children}
    </section>
  );
}
