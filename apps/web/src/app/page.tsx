import { redirect } from 'next/navigation';

export default function Home() {
  // Redirect to login if not authenticated, or dashboard if authenticated
  // In a real app, check authentication status
  redirect('/auth/login');
}
