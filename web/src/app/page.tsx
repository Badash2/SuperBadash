import App from "@/components/App";

// The whole app is client-side: data is protected by RLS in Supabase, not on the server.
export default function Page() {
  return <App />;
}
