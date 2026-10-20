/** Tampil langsung saat pindah halaman, selagi data dari database dimuat. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Memuat">
      <div className="skeleton mb-3 h-3 w-24" />
      <div className="skeleton mb-6 h-9 w-72 max-w-full" />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card">
            <div className="skeleton w-1/2" />
            <div className="skeleton h-8 w-3/4" />
            <div className="skeleton w-3/5" />
          </div>
        ))}
      </div>
    </div>
  );
}
