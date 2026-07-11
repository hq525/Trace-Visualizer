// Appendix A: the AI output contract. Deliberately has NO node/edge fields —
// AI annotates the graph, it can never draw it (G3, §5.9).
import { z } from "zod";

export const AiAnnotationSchema = z.object({
  root_cause_hypothesis: z.string(),
  confidence: z.enum(["low", "medium", "high"]),
  per_frame_notes: z.array(z.object({ frameIndex: z.number(), note: z.string() })).default([]),
  ghost_edge_explanations: z
    .array(z.object({ edgeId: z.string(), mechanism: z.string(), explanation: z.string() }))
    .default([]),
  suggested_fix: z
    .object({ file: z.string(), description: z.string(), diff: z.string().optional() })
    .optional(),
});

export type AiAnnotation = z.infer<typeof AiAnnotationSchema>;
