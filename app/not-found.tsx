import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      <div className="w-full max-w-sm mx-4 bg-white border border-gray-200 rounded-2xl p-8 text-center shadow-sm">
        <p className="text-5xl font-bold text-gray-200 mb-4">404</p>
        <h2 className="text-base font-semibold text-gray-900 mb-1">Page not found</h2>
        <p className="text-sm text-gray-500 mb-6">
          This page doesn&apos;t exist or you don&apos;t have access to it.
        </p>
        <Link
          href="/"
          className="inline-block px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Go to inbox
        </Link>
      </div>
    </div>
  );
}
