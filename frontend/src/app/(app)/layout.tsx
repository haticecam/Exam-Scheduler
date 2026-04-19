"use client";
import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";
import { useAuth } from "@/lib/auth";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated && localStorage.getItem("auth_token") === null) {
      router.push("/login");
    }
  }, [isAuthenticated, router]);

  if (!isAuthenticated && typeof window !== "undefined" && localStorage.getItem("auth_token") === null) {
    return null;
  }

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <Sidebar />
      <main style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        <Topbar />
        <div style={{ padding: "32px 36px", flex: 1 }}>
          {children}
        </div>
      </main>
    </div>
  );
}
