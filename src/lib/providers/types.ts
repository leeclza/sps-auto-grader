/**
 * Kontrak sumber tugas. Google Classroom adalah implementasi pertama;
 * e-learning ITERA (kuliah2.itera.ac.id), Google Form, dll. cukup
 * mengimplementasikan interface yang sama.
 */
export interface SourceCourse {
  externalId: string;
  name: string;
  section?: string | null;
  enrollmentCode?: string | null;
  link?: string | null;
}

export interface SourceCourseDetail extends SourceCourse {
  teacherNames: string[];
  studentCount: number;
}

export interface SourceAssignment {
  externalId: string;
  title: string;
  description?: string | null;
  maxScore?: number | null;
  dueDate?: Date | null;
  link?: string | null;
  workType?: string | null;
}

export interface TaskSourceProvider {
  id: string;
  label: string;
  listCourses(): Promise<SourceCourse[]>;
  getCourseDetail(courseId: string): Promise<SourceCourseDetail>;
  listAssignments(courseId: string): Promise<SourceAssignment[]>;
}
