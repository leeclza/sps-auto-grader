import {
  addMaterialFromFile,
  addMaterialFromUrl,
  deleteMaterial,
  relearnFailedMaterials,
  relearnMaterial,
  updateMaterial,
} from "@/app/actions";
import { AutoRefresh } from "@/components/AutoRefresh";
import { SubmitButton } from "@/components/SubmitButton";
import { requireUser } from "@/lib/auth";
import { asc, count } from "drizzle-orm";
import { db } from "@/db";
import { assignmentMaterials, materials as materialsT } from "@/db/schema";

const STATUS: Record<string, string> = { ready: "badge-ok", processing: "badge-warn", pending: "", error: "badge-err" };

export default async function MaterialsPage() {
  await requireUser();
  const [rows, usage] = await Promise.all([
    db.query.materials.findMany({
      orderBy: [asc(materialsT.subject), asc(materialsT.meeting), asc(materialsT.createdAt)],
      with: { pages: { columns: { content: true } } },
    }),
    db
      .select({ materialId: assignmentMaterials.materialId, n: count() })
      .from(assignmentMaterials)
      .groupBy(assignmentMaterials.materialId),
  ]);
  const used = new Map(usage.map((u) => [u.materialId, u.n]));
  const materials = rows.map((m) => ({ ...m, _count: { assignments: used.get(m.id) ?? 0 } }));

  const processing = materials.filter((m) => m.status === "processing").length;
  const failed = materials.filter((m) => m.status === "error").length;

  return (
    <>
      <AutoRefresh active={processing > 0} />
      <span className="eyebrow">Patokan penilaian</span>
      <h1>Materi Acuan</h1>
      <p className="mb-6.5 max-w-[68ch] text-muted">
        Materi yang di-upload akan dipelajari AI (diringkas & diekstrak konsep kuncinya) lalu dijadikan patokan saat
        menilai tugas.
      </p>

      <div className="stagger grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3.5">
        <form className="card" action={addMaterialFromUrl}>
          <h2 className="mt-0">Dari Link</h2>
          <label htmlFor="url">URL</label>
          <input id="url" name="url" type="url" required placeholder="https://informatika-itera.github.io/dtd/" />
          <label htmlFor="subject-url">Mata kuliah</label>
          <input id="subject-url" name="subject" type="text" defaultValue="DTD" />
          <label className="my-2.5 flex cursor-pointer items-start gap-2.5 font-normal text-ink">
            <input type="checkbox" name="crawl" defaultChecked className="mt-[3px] flex-none" />
            <span>Ambil juga halaman yang ditautkan di folder yang sama (mis. pertemuan-1 … pertemuan-N)</span>
          </label>
          <SubmitButton pendingText="Mengambil & mempelajari...">Tambah dari Link</SubmitButton>
        </form>

        <form className="card" action={addMaterialFromFile}>
          <h2 className="mt-0">Dari File</h2>
          <label htmlFor="files">File (PDF, DOCX, HTML, TXT/MD, kode)</label>
          <input id="files" name="files" type="file" multiple required accept=".pdf,.docx,.html,.htm,.txt,.md,.py,.c,.cpp,.java,.js,.ts,.ipynb" />
          <label htmlFor="subject-file">Mata kuliah</label>
          <input id="subject-file" name="subject" type="text" defaultValue="DTD" />
          <label htmlFor="meeting">Pertemuan ke- <span className="text-[13px] font-normal text-muted">(opsional)</span></label>
          <input id="meeting" name="meeting" type="number" min={1} />
          <div className="mt-3">
            <SubmitButton pendingText="Mengunggah & mempelajari...">Upload</SubmitButton>
          </div>
        </form>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <h2>Daftar Materi ({materials.length})</h2>
        <span className="flex-1" />
        {processing > 0 && (
          <span className="text-[13px] text-muted">AI sedang mempelajari {processing} materi (maks. ~5 per menit)…</span>
        )}
        {failed > 0 && processing === 0 && (
          <form action={relearnFailedMaterials}>
            <SubmitButton className="btn" pendingText="...">Pelajari ulang {failed} yang error</SubmitButton>
          </form>
        )}
      </div>
      {materials.length === 0 && (
        <div className="card border-dashed px-5 py-10 text-center text-muted shadow-none">Belum ada materi.</div>
      )}
      {materials.map((m) => {
        const concepts: string[] = m.keyConcepts ? JSON.parse(m.keyConcepts) : [];
        const chars = m.pages.reduce((s, p) => s + p.content.length, 0);
        const processingNow = m.status === "processing";
        return (
          <div
            key={m.id}
            className={`card mb-3.5 ${
              processingNow
                ? "overflow-hidden after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:animate-shimmer after:bg-[linear-gradient(90deg,transparent,var(--primary),transparent)] after:bg-size-[200%_100%] after:content-['']"
                : ""
            }`}
          >
            <div className="flex flex-wrap items-center gap-3">
              <span className="badge">{m.subject}{m.meeting ? ` · P${m.meeting}` : ""}</span>
              <b>{m.title}</b>
              <span className={`badge ${STATUS[m.status] ?? ""}`}>{m.status}</span>
              <span className="flex-1" />
              <span className="text-[13px] text-muted">{chars.toLocaleString("id-ID")} karakter · dipakai {m._count.assignments} tugas</span>
            </div>
            <div className="text-[13px] text-muted">
              {m.sourceUrl ? <a href={m.sourceUrl} target="_blank" rel="noreferrer">{m.sourceUrl}</a> : m.fileName}
            </div>
            {m.error && <div className="alert alert-err mt-2 text-[13px]">{m.error}</div>}
            {processingNow && !m.summary && (
              <>
                <div className="skeleton" />
                <div className="skeleton w-3/5" />
              </>
            )}
            {m.summary && <p className="mt-3 mb-1.5">{m.summary}</p>}
            {concepts.length > 0 && (
              <details className="mt-1.5">
                <summary>{concepts.length} konsep kunci</summary>
                <ul className="mt-2 list-disc pl-6">{concepts.map((c, i) => <li key={i}>{c}</li>)}</ul>
              </details>
            )}
            <div className="mt-2.5 flex flex-wrap items-center gap-3">
              <form action={updateMaterial.bind(null, m.id)} className="flex flex-wrap items-center gap-3">
                <input name="title" type="text" defaultValue={m.title} className="w-[260px]" aria-label="Judul" />
                <input name="meeting" type="number" min={1} defaultValue={m.meeting ?? ""} placeholder="Pertemuan" className="w-[110px]" aria-label="Pertemuan" />
                <SubmitButton className="btn" pendingText="...">Simpan</SubmitButton>
              </form>
              <span className="flex-1" />
              <form action={relearnMaterial.bind(null, m.id)}>
                <SubmitButton className="btn" pendingText="...">Pelajari ulang</SubmitButton>
              </form>
              <form action={deleteMaterial.bind(null, m.id)}>
                <SubmitButton className="btn btn-danger" pendingText="...">Hapus</SubmitButton>
              </form>
            </div>
          </div>
        );
      })}
    </>
  );
}
