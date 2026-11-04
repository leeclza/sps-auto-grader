import { and, eq, inArray } from "drizzle-orm";
import { FeedbackCell } from "@/components/FeedbackCell";
import { SimilarityAction } from "@/components/SimilarityAction";
import { db } from "@/db";
import { submissions } from "@/db/schema";
import type { CriterionScore } from "@/lib/grading";
import type { RubricCriterion } from "@/lib/rubric";
import type { SimilarityMatch } from "@/lib/similarity";

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Belum dinilai", cls: "badge" },
  processing: { label: "Sedang dinilai…", cls: "badge badge-warn" },
  graded: { label: "Dinilai AI", cls: "badge badge-ok" },
  reviewed: { label: "Dicek", cls: "badge badge-ok" },
  error: { label: "Gagal", cls: "badge badge-err" },
};

type Similar = { similarity: string | null; similarityDecision: string | null };
export const matchesOf = (s: Similar): SimilarityMatch[] => (s.similarity ? JSON.parse(s.similarity) : []);
export const needsCheck = (s: Similar) => !s.similarityDecision && matchesOf(s).length > 0;

/** Render baris tabel nilai untuk submission `ids` (urutan dipertahankan). Hanya baris ini yang diambil penuh. */
export async function gradeRows(assignmentId: string, ids: string[], rubric: RubricCriterion[], currentId: string | null) {
  if (ids.length === 0) return null;
  const rows = await db.query.submissions.findMany({
    where: and(eq(submissions.assignmentId, assignmentId), inArray(submissions.id, ids)),
    columns: { content: false, textSegments: false },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => {
    const s = byId.get(id);
    if (!s) return null;
    const scores: CriterionScore[] = s.breakdown ? JSON.parse(s.breakdown) : [];
    const st =
      s.status === "processing" && s.id !== currentId
        ? { label: "Menunggu antrean", cls: "badge" }
        : (STATUS[s.status] ?? { label: s.status, cls: "badge" });
    const matches = matchesOf(s);
    return (
      <tr key={s.id} className={needsCheck(s) ? "bg-warn-bg" : undefined}>
        <td>
          <div>{s.studentName ?? s.studentId}</div>
          <div className="text-[13px] text-muted">{s.studentEmail}{s.late && " · terlambat"}</div>
        </td>
        {rubric.map((c) => {
          const sc = scores.find((x) => x.name === c.name);
          return <td key={c.name} title={sc?.comment}>{sc ? sc.score : "—"}</td>;
        })}
        <td><b>{s.finalScore ?? "—"}</b></td>
        <td>
          <span className={st.cls}>{st.label}</span>
          {matches.length > 0 && (
            <div className="mt-1">
              {s.similarityDecision === "rejected" ? (
                <span className="badge badge-err">Mirip · ditolak</span>
              ) : s.similarityDecision === "accepted" ? (
                <span className="badge badge-ok">Mirip · diterima</span>
              ) : (
                <span className="badge badge-warn">Mirip, perlu dicek</span>
              )}
            </div>
          )}
        </td>
        <td>
          <SimilarityAction
            submissionId={s.id}
            student={s.studentName ?? s.studentId}
            matches={matches}
            decision={s.similarityDecision}
          />
        </td>
        <td>
          <FeedbackCell
            student={s.studentName ?? s.studentId}
            text={(s.status === "error" ? s.error : s.feedback) ?? ""}
            error={s.status === "error"}
            comments={scores}
          />
        </td>
      </tr>
    );
  });
}
