// Pass-through layout. Use <AppShell> in each page instead.
export default function PassThroughLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
