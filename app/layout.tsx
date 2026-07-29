import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") || "localhost";
  const protocol = host.includes("localhost") ? "http" : "https";
  const origin = `${protocol}://${host}`;
  return {
    title: "Controle de RNC",
    description: "Gestão de Relatórios de Não Conformidade, prazos, respostas e retornos.",
    icons: { icon: "/favicon-rnc.png", shortcut: "/favicon-rnc.png", apple: "/favicon-rnc.png" },
    openGraph: {
      title: "Controle de RNC",
      description: "Gestão de não conformidades",
      images: [`${origin}/og.png`],
      locale: "pt_BR",
      type: "website",
    },
    twitter: { card: "summary_large_image", images: [`${origin}/og.png`] },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
