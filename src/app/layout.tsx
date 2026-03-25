import type { Metadata } from "next";
import { Lexend, Manrope, Inter } from "next/font/google";
import { AppShell } from "@/components/layout/AppShell";
import { Providers } from "@/components/providers/Providers";
import { GoogleAnalytics } from "@/components/GoogleAnalytics";
import "./globals.css";

const lexend = Lexend({
  subsets: ["latin"],
  variable: "--font-headline",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-label",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://centrepass.io"),
  title: {
    default: "CentrePass - Suncorp Super Netball Scores",
    template: "%s | CentrePass",
  },
  description:
    "Live scores, box scores, standings, fixtures, and player stats for Suncorp Super Netball.",
  openGraph: {
    siteName: "CentrePass",
    type: "website",
    locale: "en_AU",
  },
  twitter: {
    card: "summary_large_image",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${lexend.variable} ${manrope.variable} ${inter.variable}`}
    >
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
        {process.env.NEXT_PUBLIC_GSC_VERIFICATION && (
          <meta
            name="google-site-verification"
            content={process.env.NEXT_PUBLIC_GSC_VERIFICATION}
          />
        )}
      </head>
      <body className="font-body antialiased">
        <GoogleAnalytics />
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
