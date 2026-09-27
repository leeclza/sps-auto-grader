import { addMaterialFromFile, addMaterialFromUrl, deleteMaterial, relearnMaterial, updateMaterial } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const STATUS: Record<string, string> = { ready: "ok", processing: "warn", pending: "", error: "err" };

export default async function MaterialsPage() {
  await requireUser();
  const materials = await prisma.material.findMany({
    orderBy: [{ subject: "asc" }, { meeting: "asc" }, { createdAt: "asc" }],
    include: { _count: { select: { assignments: true } }, pages: { select: { content: true } } },
  });

  return (
    <>
      <h1>Materi Acuan</h1>
      <p className="sub">
        Materi yang di-upload akan dipelajari AI (diringkas & diekstrak konsep kuncinya) lalu dijadikan patokan saat
        menilai tugas.
      </p>

      <div className="grid">
        <form className="card" action={addMaterialFromUrl}>
          <h2 style={{ marginTop: 0 }}>Dari Link</h2>
          <label htmlFor="url">URL</label>
          <input id="url" name="url" type="url" required placeholder="https://informatika-itera.github.io/dtd/" />
          <label htmlFor="subject-url">Mata kuliah</label>
          <input id="subject-url" name="subject" type="text" defaultValue="DTD" />
          <label className="check">
            <input type="checkbox" name="crawl" defaultChecked />
            <span>Ambil juga halaman yang ditautkan di folder yang sama (mis. pertemuan-1 … pertemuan-N)</span>
          </label>
          <SubmitButton pendingText="Mengambil & mempelajari...">Tambah dari Link</SubmitButton>
        </form>

        <form className="card" action={addMaterialFromFile}>
          <h2 style={{ marginTop: 0 }}>Dari File</h2>
          <label htmlFor="files">File (PDF, DOCX, HTML, TXT/MD, kode)</label>
          <input id="files" name="files" type="file" multiple required accept=".pdf,.docx,.html,.htm,.txt,.md,.py,.c,.cpp,.java,.js,.ts,.ipynb" />
          <label htmlFor="subject-file">Mata kuliah</label>
          <input id="subject-file" name="subject" type="text" defaultValue="DTD" />
          <label htmlFor="meeting">Pertemuan ke- <span className="muted small">(opsional)</span></label>
          <input id="meeting" name="meeting" type="number" min={1} />
          <div style={{ marginTop: 12 }}>
            <SubmitButton pendingText="Mengunggah & mempelajari...">Upload</SubmitButton>
          </div>
        </form>
      </div>

      <h2>Daftar Materi ({materials.length})</h2>
      {materials.length === 0 && <div className="card muted">Belum ada materi.</div>}
      {materials.map((m) => {
        const concepts: string[] = m.keyConcepts ? JSON.parse(m.keyConcepts) : [];
        const chars = m.pages.reduce((s, p) => s + p.content.length, 0);
        return (
          <div className="card" key={m.id}>
            <div className="row">
              <span className="badge">{m.subject}{m.meeting ? ` · P${m.meeting}` : ""}</span>
              <b>{m.title}</b>
              <span className={`badge ${STATUS[m.status] ?? ""}`}>{m.status}</span>
              <span className="spacer" />
              <span className="muted small">{chars.toLocaleString("id-ID")} karakter · dipakai {m._count.assignments} tugas</span>
            </div>
            <div className="muted small">
              {m.sourceUrl ? <a href={m.sourceUrl} target="_blank" rel="noreferrer">{m.sourceUrl}</a> : m.fileName}
            </div>
            {m.error && <div className="alert err small" style={{ marginTop: 8 }}>{m.error}</div>}
            {m.summary && <p style={{ marginBottom: 6 }}>{m.summary}</p>}
            {concepts.length > 0 && (
              <details>
                <summary>{concepts.length} konsep kunci</summary>
                <ul>{concepts.map((c, i) => <li key={i}>{c}</li>)}</ul>
              </details>
            )}
            <div className="row" style={{ marginTop: 10 }}>
              <form action={updateMaterial.bind(null, m.id)} className="row">
                <input name="title" type="text" defaultValue={m.title} style={{ width: 260 }} aria-label="Judul" />
                <input name="meeting" type="number" min={1} defaultValue={m.meeting ?? ""} placeholder="Pertemuan" style={{ width: 110 }} aria-label="Pertemuan" />
                <SubmitButton className="btn" pendingText="...">Simpan</SubmitButton>
              </form>
              <span className="spacer" />
              <form action={relearnMaterial.bind(null, m.id)}>
                <SubmitButton className="btn" pendingText="Mempelajari...">Pelajari ulang</SubmitButton>
              </form>
              <form action={deleteMaterial.bind(null, m.id)}>
                <SubmitButton className="btn danger" pendingText="...">Hapus</SubmitButton>
              </form>
            </div>
          </div>
        );
      })}
    </>
  );
}
