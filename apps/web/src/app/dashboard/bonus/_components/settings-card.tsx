import type { ReactNode } from 'react';
import type { Icon } from '@tabler/icons-react';

/** One titled group on the bonus settings page. The id is the in-page anchor. */
export function SettingsCard({
  id,
  icon: CardIcon,
  title,
  description,
  aside,
  children,
}: {
  id: string;
  icon: Icon;
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="panel scroll-mt-20">
      <div className="panel-header items-start">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] bg-blue-50 text-blue-600">
            <CardIcon className="h-[18px] w-[18px]" stroke={1.8} />
          </span>
          <div className="min-w-0">
            <h2 className="section-title">{title}</h2>
            {description ? <p className="mt-0.5 text-sm text-gray-500">{description}</p> : null}
          </div>
        </div>
        {aside ? <div className="flex flex-shrink-0 items-center gap-2">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Label and help text on the left, the control on the right. Stacks under md. */
export function SettingRow({
  label,
  help,
  children,
}: {
  label: ReactNode;
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 py-4 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] md:gap-6">
      <div className="min-w-0">
        <div className="text-sm font-medium text-gray-900">{label}</div>
        {help ? <div className="field-help">{help}</div> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Bottom bar of a settings form: actions aligned right. */
export function SettingsFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 px-5 py-4 sm:px-6">
      {children}
    </div>
  );
}
