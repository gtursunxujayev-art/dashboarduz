import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import { Providers } from './providers';
import { AuthProvider } from '@/contexts/auth-context';

export const metadata: Metadata = {
  title: 'Dashboarduz - Ko\'p ijarachili CRM integratori',
  description: 'AmoCRM, Telegram va Google Sheets xizmatlarini bitta platformada boshqaring',
};

// Applies the saved (or system) theme before first paint so no page flashes the wrong mode.
const themeBootScript = `(function(){try{var s=localStorage.getItem('dashboarduz-theme');var t=(s==='dark'||s==='light')?s:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');var r=document.documentElement;r.classList.toggle('dark',t==='dark');r.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="uz" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="font-sans">
        <Providers>
          <AuthProvider>
            {children}
          </AuthProvider>
        </Providers>
      </body>
    </html>
  );
}
