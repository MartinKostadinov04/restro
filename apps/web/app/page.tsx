import { redirect } from 'next/navigation'

// The admin has no landing page of its own: the venues are the home screen. Not signed in? The
// proxy has already sent the visitor to /login before this runs.
export default function HomePage() {
  redirect('/venues')
}
