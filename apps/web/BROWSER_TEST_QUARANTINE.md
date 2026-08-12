# Browser geometry verification

The browser suite keeps pixel/font/layout tests in a separate `[geometry:linux]`
group so failures remain attributable, but both stable and geometry groups are
blocking CI gates. Runtime, event-stream, teardown, and unhandled errors remain
in the stable group.

Owner for every entry: `web/transcript`.

The former `continue-on-error` quarantine ended on 2026-08-12 after the suite's
virtualization oracle was restored to the current LegendList DOM contract. Keep
this inventory as the ownership and scope record for the separate blocking job.

The original Linux failure evidence is commit `7c80c0dee`, whose CI run reported
12+ ChatView geometry failures after browser tests first moved to hosted Ubuntu.
The current geometry group contains only assertions whose result depends
directly on pixel/font/layout measurements.

| Full test name                                                                                                                                                        | Cases | Reason                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----: | ------------------------------------------------------------------------------------------------ |
| `ChatView timeline estimator parity (full app) [geometry:linux] keeps long user message estimate close at the $name viewport`                                         |     4 | Compares rendered text height with an estimator at desktop, tablet, mobile, and narrow widths.   |
| `ChatView timeline estimator parity (full app) [geometry:linux] tracks wrapping parity while resizing an existing ChatView across the viewport matrix`                |     1 | Compares measured and estimated wrapping after viewport resizes.                                 |
| `ChatView timeline estimator parity (full app) [geometry:linux] tracks additional rendered wrapping when ChatView width narrows between desktop and mobile viewports` |     1 | Compares pixel-height deltas and their ratio across viewport widths.                             |
| `ChatView timeline estimator parity (full app) [geometry:linux] collapses header actions into overflow before they can overlap the thread title`                      |     1 | Compares bounding rectangles under a narrow viewport.                                            |
| `ChatView timeline estimator parity (full app) [geometry:linux] keeps the composer visible while a long assistant response forces a viewport relayout`                |     1 | Compares composer, host, and scroll-container geometry across viewport sizes.                    |
| `ChatView timeline estimator parity (full app) [geometry:linux] keeps user attachment estimate close at the $name viewport`                                           |     3 | Compares rendered attachment-row height with an estimator at desktop, mobile, and narrow widths. |

Total blocking geometry cases: **11**.

Explicitly retained in the stable blocking group:

- delayed attachment loading must remain bottom-stuck;
- optimistic user sends must re-stick to the bottom, and the sent message must
  glide to its anchor in one motion and hold it;
- orchestration event replay/deduplication and keybinding config notifications;
- any browser runtime or unhandled error.
