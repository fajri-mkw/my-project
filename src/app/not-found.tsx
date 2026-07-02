import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50">
      <div className="text-center p-8">
        <h1 className="text-6xl font-bold text-stone-800 mb-4">404</h1>
        <p className="text-lg text-stone-600 mb-6">Halaman tidak ditemukan</p>
        <Link
          href="/"
          className="inline-block px-6 py-3 bg-stone-800 text-white rounded-lg hover:bg-stone-700 transition-colors"
        >
          Kembali ke Beranda
        </Link>
      </div>
    </div>
  )
}
