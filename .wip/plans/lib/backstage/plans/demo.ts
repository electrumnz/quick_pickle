/**
 * Plans, for a deployment with no database.
 *
 * The starter content is real and goes in as it would for a real owner. On
 * top of it come a handful of invented records so the screens have something
 * moving: a few tasks at different stages, and one example question with an
 * example answer. Everything goes in through the same operations a person
 * would use.
 */

import type { Db } from "@/lib/db/types";
import { addDays, nzDateKey } from "@/lib/time";

import { systemCaller } from "../core/actor";
import { OpError } from "../core/errors";
import { execute } from "../core/op";
import { getOrder } from "../orders/ops";
import {
  addQuestion,
  addTask,
  answerQuestion,
  finishTask,
  loadStarter,
  startTask,
} from "./ops";

const HOUR = 60 * 60_000;

type DemoTask = {
  readonly title: string;
  readonly notes?: string;
  readonly area: string;
  /** Days from today. Negative is overdue. */
  readonly dueIn?: number;
  readonly hoursAgo: number;
  readonly then?: "doing" | "done";
  /** A demo order this task is about, by its number. */
  readonly aboutOrder?: string;
};

const TASKS: readonly DemoTask[] = [
  {
    title: "Reply to the club about a standing order",
    notes: "They asked on the order. Say what a regular box would look like.",
    area: "orders",
    dueIn: -1,
    hoursAgo: 90,
    aboutOrder: "QP-SENT66",
  },
  {
    title: "Ring a courier for a quote on each pack size",
    notes: "Town and rural. The answer goes on the Budget.",
    area: "delivery",
    dueIn: 0,
    hoursAgo: 50,
  },
  {
    title: "Count the labels left on the roll",
    area: "production",
    hoursAgo: 26,
    then: "doing",
  },
  {
    title: "Read the recall sheet once, start to finish",
    area: "production",
    dueIn: 6,
    hoursAgo: 20,
  },
  {
    title: "Photograph the bottle on plain card",
    area: "brand",
    dueIn: -3,
    hoursAgo: 120,
    then: "done",
  },
];

export async function seedPlansDemo(db: Db, now: Date): Promise<void> {
  const demo = systemCaller("Demo data", "script");
  const at = (hoursAgo: number) => ({
    db,
    now: new Date(now.getTime() - hoursAgo * HOUR),
  });
  const today = nzDateKey(now);

  await execute(loadStarter, {}, demo, at(200));

  for (const task of TASKS) {
    let about: { entityType: string; entityId: string } | null = null;
    if (task.aboutOrder !== undefined) {
      try {
        const order = await execute(
          getOrder,
          { number: task.aboutOrder },
          demo,
          { db },
        );
        about = { entityType: "order", entityId: order.id };
      } catch (error) {
        // No demo orders in this database: the task stands by itself.
        if (!(error instanceof OpError)) throw error;
      }
    }
    const { id } = await execute(
      addTask,
      {
        title: task.title,
        notes: task.notes,
        area: task.area,
        dueOn:
          task.dueIn === undefined ? undefined : addDays(today, task.dueIn),
        ...(about ?? {}),
      },
      demo,
      at(task.hoursAgo),
    );
    if (task.then === "doing") {
      await execute(startTask, { id }, demo, at(task.hoursAgo - 2));
    }
    if (task.then === "done") {
      await execute(finishTask, { id }, demo, at(task.hoursAgo - 30));
    }
  }

  const { id } = await execute(
    addQuestion,
    {
      topic: "Example",
      question:
        "Example question: which days of the week are orders packed and sent?",
      why: "An invented question, here to show what an answered one looks like. It is not part of the real list.",
      askOf: "Demo owner",
      source: "Demo data",
      // After every real topic.
      sort: 9000,
    },
    demo,
    at(70),
  );
  await execute(
    answerQuestion,
    {
      id,
      answer:
        "Example answer: Mondays and Thursdays, so nothing sits with the courier over a weekend.",
    },
    demo,
    at(44),
  );
}
