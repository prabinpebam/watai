import { identityFromClaims } from '../auth/identity';
import { parseAppendMessage } from '../domain/message';
import type { MessageService } from '../application/messageService';
import { respond } from './respond';
import type { ApiRequest, HttpResult } from './types';

/**
 * HTTP boundary for messages, always scoped to a parent thread the caller owns.
 * Identity comes from the validated token; ownership is enforced in the service.
 */
export function createMessagesController(messages: MessageService) {
  return {
    list: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        const limitRaw = req.query?.limit;
        const limit = limitRaw && /^\d+$/.test(limitRaw) ? Number(limitRaw) : undefined;
        return {
          messages: await messages.list(userId, req.params!.threadId, {
            since: req.query?.since,
            limit,
          }),
        };
      }),

    append: (req: ApiRequest): Promise<HttpResult> =>
      respond(201, async () => {
        const { userId } = identityFromClaims(req.claims);
        return messages.append(userId, req.params!.threadId, parseAppendMessage(req.body));
      }),
  };
}
