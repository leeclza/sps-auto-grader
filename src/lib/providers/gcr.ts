import { google, type classroom_v1 } from "googleapis";
import { getGoogleAuth } from "../google";
import type { SourceAssignment, SourceCourseDetail, TaskSourceProvider } from "./types";

async function paginate<T>(fetchPage: (pageToken?: string) => Promise<{ items: T[]; next?: string | null }>) {
  const all: T[] = [];
  let token: string | undefined;
  do {
    const { items, next } = await fetchPage(token);
    all.push(...items);
    token = next ?? undefined;
  } while (token);
  return all;
}

function toDate(d?: classroom_v1.Schema$Date, t?: classroom_v1.Schema$TimeOfDay) {
  if (!d?.year || !d.month || !d.day) return null;
  return new Date(Date.UTC(d.year, d.month - 1, d.day, t?.hours ?? 23, t?.minutes ?? 59));
}

/** Google Classroom lewat API resmi (OAuth, read-only) — tanpa scraping. */
export async function gcrProvider(userId: string): Promise<TaskSourceProvider> {
  const classroom = google.classroom({ version: "v1", auth: await getGoogleAuth(userId) });

  return {
    id: "gcr",
    label: "Google Classroom",

    async listCourses() {
      const courses = await paginate(async (pageToken) => {
        const res = await classroom.courses.list({ pageToken, pageSize: 100, courseStates: ["ACTIVE"], teacherId: "me" });
        return { items: res.data.courses ?? [], next: res.data.nextPageToken };
      });
      return courses.map((c) => ({
        externalId: c.id!,
        name: c.name ?? "(tanpa nama)",
        section: c.section,
        enrollmentCode: c.enrollmentCode,
        link: c.alternateLink,
        createdAt: c.creationTime ? new Date(c.creationTime) : null,
      }));
    },

    async getCourseDetail(courseId): Promise<SourceCourseDetail> {
      const [course, teachers, students] = await Promise.all([
        classroom.courses.get({ id: courseId }),
        paginate(async (pageToken) => {
          const res = await classroom.courses.teachers.list({ courseId, pageToken, pageSize: 100 });
          return { items: res.data.teachers ?? [], next: res.data.nextPageToken };
        }),
        paginate(async (pageToken) => {
          const res = await classroom.courses.students.list({ courseId, pageToken, pageSize: 100 });
          return { items: res.data.students ?? [], next: res.data.nextPageToken };
        }),
      ]);
      return {
        externalId: courseId,
        name: course.data.name ?? "(tanpa nama)",
        section: course.data.section,
        enrollmentCode: course.data.enrollmentCode,
        link: course.data.alternateLink,
        teacherNames: teachers.map((t) => t.profile?.name?.fullName ?? t.profile?.emailAddress ?? "?"),
        studentCount: students.length,
      };
    },

    async listAssignments(courseId): Promise<SourceAssignment[]> {
      const work = await paginate(async (pageToken) => {
        const res = await classroom.courses.courseWork.list({
          courseId,
          pageToken,
          pageSize: 100,
          orderBy: "updateTime desc",
        });
        return { items: res.data.courseWork ?? [], next: res.data.nextPageToken };
      });
      return work.map((w) => ({
        externalId: w.id!,
        title: w.title ?? "(tanpa judul)",
        description: w.description,
        maxScore: w.maxPoints,
        dueDate: toDate(w.dueDate, w.dueTime),
        link: w.alternateLink,
        workType: w.workType,
      }));
    },
  };
}
