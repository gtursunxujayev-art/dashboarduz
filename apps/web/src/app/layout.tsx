import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';
import { AuthProvider } from '@/contexts/auth-context';

export const metadata: Metadata = {
  title: 'Dashboarduz - Ko\'p ijarachili CRM integratori',
  description: 'AmoCRM, Telegram va Google Sheets xizmatlarini bitta platformada boshqaring',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="uz">
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
