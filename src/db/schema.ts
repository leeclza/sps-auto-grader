import { relations } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const ts = (name: string) => timestamp(name, { precision: 3, mode: "date" });

// ---------- Auth (NextAuth) ----------

export const users = pgTable("User", {
  id: id(),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: ts("emailVerified"),
  image: text("image"),
});

export const accounts = pgTable(
  "Account",
  {
    id: id(),
    userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    refresh_token_expires_in: integer("refresh_token_expires_in"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [uniqueIndex("Account_provider_providerAccountId_key").on(t.provider, t.providerAccountId)],
);

export const sessions = pgTable("Session", {
  id: id(),
  sessionToken: text("sessionToken").notNull().unique(),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires: ts("expires").notNull(),
});

export const verificationTokens = pgTable(
  "VerificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull().unique(),
    expires: ts("expires").notNull(),
  },
  (t) => [uniqueIndex("VerificationToken_identifier_token_key").on(t.identifier, t.token)],
);

// ---------- Sumber tugas (multi-provider) ----------
// provider: "gcr" (Google Classroom) | "elearning" (kuliah2.itera.ac.id) | "gform" | "manual"

export const courses = pgTable(
  "Course",
  {
    id: id(),
    userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("gcr"),
    externalId: text("externalId").notNull(),
    name: text("name").notNull(),
    section: text("section"),
    enrollmentCode: text("enrollmentCode"),
    teacherNames: text("teacherNames"),
    studentCount: integer("studentCount"),
    link: text("link"),
    createdAt: ts("createdAt"),
    syncedAt: ts("syncedAt").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("Course_userId_provider_externalId_key").on(t.userId, t.provider, t.externalId)],
);

export const assignments = pgTable(
  "Assignment",
  {
    id: id(),
    courseId: text("courseId").notNull().references(() => courses.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("gcr"),
    externalId: text("externalId").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    instructions: text("instructions"),
    maxScore: doublePrecision("maxScore").notNull().default(100),
    dueDate: ts("dueDate"),
    link: text("link"),
    workType: text("workType"),
    imported: boolean("imported").notNull().default(false),
    // Rubrik disimpan sebagai JSON: [{ name, description, weight }]
    rubric: text("rubric"),
    gradingNotes: text("gradingNotes"),
    updatedAt: ts("updatedAt").notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("Assignment_courseId_externalId_key").on(t.courseId, t.externalId)],
);

// ---------- Materi (patokan penilaian AI) ----------
// kind: "url" | "file" | "text"
// status: "pending" | "processing" | "ready" | "error"

export const materials = pgTable("Material", {
  id: id(),
  title: text("title").notNull(),
  subject: text("subject").notNull().default("DTD"),
  meeting: integer("meeting"),
  kind: text("kind").notNull(),
  sourceUrl: text("sourceUrl"),
  fileName: text("fileName"),
  status: text("status").notNull().default("pending"),
  error: text("error"),
  summary: text("summary"),
  keyConcepts: text("keyConcepts"),
  createdAt: ts("createdAt").notNull().defaultNow(),
});

export const materialPages = pgTable("MaterialPage", {
  id: id(),
  materialId: text("materialId").notNull().references(() => materials.id, { onDelete: "cascade" }),
  url: text("url"),
  title: text("title"),
  content: text("content").notNull(),
  order: integer("order").notNull().default(0),
});

export const assignmentMaterials = pgTable(
  "AssignmentMaterial",
  {
    assignmentId: text("assignmentId").notNull().references(() => assignments.id, { onDelete: "cascade" }),
    materialId: text("materialId").notNull().references(() => materials.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.assignmentId, t.materialId] })],
);

// ---------- Relasi (untuk db.query) ----------

export const coursesRelations = relations(courses, ({ many }) => ({ assignments: many(assignments) }));

export const assignmentsRelations = relations(assignments, ({ one, many }) => ({
  course: one(courses, { fields: [assignments.courseId], references: [courses.id] }),
  materials: many(assignmentMaterials),
}));

export const materialsRelations = relations(materials, ({ many }) => ({
  pages: many(materialPages),
  assignments: many(assignmentMaterials),
}));

export const materialPagesRelations = relations(materialPages, ({ one }) => ({
  material: one(materials, { fields: [materialPages.materialId], references: [materials.id] }),
}));

export const assignmentMaterialsRelations = relations(assignmentMaterials, ({ one }) => ({
  assignment: one(assignments, { fields: [assignmentMaterials.assignmentId], references: [assignments.id] }),
  material: one(materials, { fields: [assignmentMaterials.materialId], references: [materials.id] }),
}));
