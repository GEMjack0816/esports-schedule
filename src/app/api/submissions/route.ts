import { getReviewRepository } from "@/lib/review/repository";
import { handleSubmissionPost } from "./handler";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleSubmissionPost(
    request,
    (input, sourceHash) => getReviewRepository().createPublicSubmission(input, sourceHash),
  );
}
