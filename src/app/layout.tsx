import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Kitchen Planner",
  description: "A reviewed weekly production and staffing plan for Sample Central Kitchen.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

