import type { Metadata } from "next";
import "bootstrap/dist/css/bootstrap.min.css";
import "./globals.css";
import { ThemeProvider } from "@/context/ThemeContext";
import { DataProvider } from "@/context/DataContext";

export const metadata: Metadata = {
  title: "VantaVault - Valorant Inventory Manager",
  description: "Manage your Valorant skins and presets",
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
