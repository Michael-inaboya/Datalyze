import Link from "next/link";

export function Logo() {
  return (
    <Link href="/" className="brand">
      <span className="logo">
        Data<span>lyze</span>
      </span>
    </Link>
  );
}
