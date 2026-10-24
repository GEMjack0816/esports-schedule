import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "赛程审核管理",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="admin-shell">{children}</div>;
}
