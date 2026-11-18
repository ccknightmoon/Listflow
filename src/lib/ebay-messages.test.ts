import { describe, it, expect, vi, beforeEach } from "vitest";

const tradingRequest = vi.fn();
vi.mock("@/lib/ebay-inventory", () => ({ tradingRequest: (...a: unknown[]) => tradingRequest(...a) }));

import { fetchUnansweredQuestions, makeGetMemberMessagesXml, parseTotalPages } from "@/lib/ebay-messages";

const q = (id: string) =>
  `<MemberMessageExchange><Item><ItemID>9${id}</ItemID><Title>Item ${id}</Title></Item><Question><MessageID>${id}</MessageID><SenderID>buyer${id}</SenderID><Subject>Hi</Subject><Body>Still available?</Body><CreationDate>2026-11-10T00:00:00Z</CreationDate></Question></MemberMessageExchange>`;
const page = (ids: string[], total: number, ack = "Success") =>
  `<GetMemberMessagesResponse><Ack>${ack}</Ack><MemberMessage>${ids.map(q).join("")}</MemberMessage><PaginationResult><TotalNumberOfPages>${total}</TotalNumberOfPages></PaginationResult></GetMemberMessagesResponse>`;

beforeEach(() => tradingRequest.mockReset());

describe("GetMemberMessages pagination", () => {
  it("requests 200 per page with a page number", () => {
    const xml = makeGetMemberMessagesXml(3, new Date("2026-11-17T00:00:00Z"));
    expect(xml).toContain("<EntriesPerPage>200</EntriesPerPage><PageNumber>3</PageNumber>");
    expect(xml).toContain("<MessageStatus>Unanswered</MessageStatus>");
  });

  it("parses total pages, defaulting to 1", () => {
    expect(parseTotalPages(page([], 4))).toBe(4);
    expect(parseTotalPages("<Ack>Success</Ack>")).toBe(1);
  });

  it("reads every page, not just the first", async () => {
    tradingRequest
      .mockResolvedValueOnce({ body: page(["1", "2"], 3) })
      .mockResolvedValueOnce({ body: page(["3"], 3) })
      .mockResolvedValueOnce({ body: page(["4", "2"], 3) });
    const r = await fetchUnansweredQuestions();
    expect(tradingRequest).toHaveBeenCalledTimes(3);
    expect(r.questions.map((x) => x.messageId)).toEqual(["1", "2", "3", "4"]);
    expect(r.questions[0].itemTitle).toBe("Item 1");
  });

  it("keeps earlier pages if a later page fails", async () => {
    tradingRequest
      .mockResolvedValueOnce({ body: page(["1"], 2) })
      .mockResolvedValueOnce({ body: page([], 2, "Failure") });
    const r = await fetchUnansweredQuestions();
    expect(r.questions).toHaveLength(1);
    expect(r.error).toBeUndefined();
  });

  it("reports a reconnect on an auth failure", async () => {
    tradingRequest.mockResolvedValueOnce({ body: "<Ack>Failure</Ack><LongMessage>Auth token is invalid</LongMessage>" });
    const r = await fetchUnansweredQuestions();
    expect(r).toMatchObject({ questions: [], reconnect: true });
  });
});
