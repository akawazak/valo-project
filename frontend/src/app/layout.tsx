import type { Metadata, Viewport } from "next";
import "bootstrap/dist/css/bootstrap.min.css";
import "./globals.css";
import { ThemeProvider } from "@/context/ThemeContext";
import { DataProvider } from "@/context/DataContext";

export const metadata: Metadata = {
  title: "VantaVault - Valorant Inventory Manager",
  description: "Manage your Valorant skins and presets",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark",
  themeColor: "#060b0f",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <DataProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </DataProvider>
      </body>
    </html>
  );
}
