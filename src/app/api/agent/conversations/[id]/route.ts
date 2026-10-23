import {
  deleteConversation,
  getConversation,
  listMessages,
} from "@/lib/agent/store";
import {
  journeyAccount,
  journeyFailure,
  journeyResponse,
} from "@/lib/journey-http";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const a = await journeyAccount(request);
    const { id } = await context.params;
    return journeyResponse({
      conversation: await getConversation(a.id, id),
      messages: await listMessages(a.id, id),
    });
  } catch (e) {
    return journeyFailure(e);
  }
}
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const a = await journeyAccount(request, true);
    await deleteConversation(a.id, (await context.params).id);
    return journeyResponse({ deleted: true });
  } catch (e) {
    return journeyFailure(e);
  }
}
