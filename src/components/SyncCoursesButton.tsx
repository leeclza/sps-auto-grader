"use client";

import { useActionState, useEffect } from "react";
import { syncCourses, type SyncResult } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { useToast } from "@/components/Toaster";

export function SyncCoursesButton() {
  const [result, action] = useActionState<SyncResult | null>(() => syncCourses(), null);
  const toast = useToast();

  useEffect(() => {
    if (result) toast({ tone: result.tone, message: result.message });
  }, [result, toast]);

  return (
    <form action={action}>
      <SubmitButton pendingText="Mengambil dari GCR...">Sinkronkan dari Google Classroom</SubmitButton>
    </form>
  );
}
