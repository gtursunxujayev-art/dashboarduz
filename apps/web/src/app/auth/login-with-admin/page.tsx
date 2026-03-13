import { redirect } from 'next/navigation';

export default function LoginWithAdminRedirectPage() {
  redirect('/auth/login');
}
