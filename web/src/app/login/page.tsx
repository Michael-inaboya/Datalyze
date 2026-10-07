import { Suspense } from "react";
import { LoginForm } from "@/components/LoginForm";
import { Logo } from "@/components/Logo";

export default function LoginPage() {
  return (
    <div className="narrow">
      <Logo />
      <Suspense fallback={<div className="panel">Loading…</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
