import React from "react";

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-slate-200 bg-white text-slate-500 text-center py-4 text-sm">
      <div className="max-w-7xl mx-auto px-6">
        © {year} Jtservices · L'informatique chez vous, pour vous
      </div>
    </footer>
  );
}