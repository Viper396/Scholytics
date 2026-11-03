import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const interSans = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Scholytics — Semantic Research Discovery & Synthesis",
  description:
    "Explore live arXiv research papers with semantic vector discovery, neural synthesis, paper comparisons, and interactive relationship topologies.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${interSans.variable} ${jetbrainsMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-[#051424] text-[#eaf2ff] selection:bg-cyan-500/25 selection:text-white">
        {children}
      </body>
    </html>
  );
}
