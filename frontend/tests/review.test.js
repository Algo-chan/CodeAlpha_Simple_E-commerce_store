/**
 * Review helpers.
 *
 * The decisions the orders page makes before it speaks to the server. All pure,
 * all testable without a browser or a database.
 *
 * The important pins:
 *   - the request body is snake_case and carries ONLY the order item id, rating
 *     and (optional) text — no product_id, because the server derives the
 *     product from the purchase;
 *   - blank title/comment are omitted rather than sent as "", matching the
 *     backend's "at least one non-blank field" rule;
 *   - a draft is submittable only when the server would accept it, so the button
 *     disables instead of round-tripping to a 422;
 *   - a known error code gets specific copy, and an unknown one degrades to the
 *     message rather than to "undefined".
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REVIEW_RATING_VALUES,
  buildReviewBody,
  isReviewSubmittable,
  groupReviewableByOrder,
  describeReviewError,
  reviewStatusLabel,
} from '../js/utils/review.js';

test('buildReviewBody maps camelCase to the snake_case request body', () => {
  const body = buildReviewBody({
    orderItemId: '5f2c1e80-0000-4000-8000-000000000001',
    rating: 5,
    title: 'Really good',
    comment: 'It arrived fast.',
  });

  assert.deepEqual(body, {
    order_item_id: '5f2c1e80-0000-4000-8000-000000000001',
    rating: 5,
    title: 'Really good',
    comment: 'It arrived fast.',
  });
});

test('buildReviewBody omits blank title and comment rather than sending empty strings', () => {
  const body = buildReviewBody({
    orderItemId: '5f2c1e80-0000-4000-8000-000000000002',
    rating: 4,
    title: '   ',
    comment: '',
  });

  assert.equal('title' in body, false);
  assert.equal('comment' in body, false);
});

test('buildReviewBody never carries a product_id — the purchase decides the product', () => {
  const body = buildReviewBody({
    orderItemId: '5f2c1e80-0000-4000-8000-000000000003',
    rating: 3,
    productId: '5f2c1e80-0000-4000-8000-0000000000ff',
    product_id: '5f2c1e80-0000-4000-8000-0000000000ff',
    title: 'x',
  });

  assert.equal('productId' in body, false);
  assert.equal('product_id' in body, false);
});

test('buildReviewBody coerces a star rating to a whole number', () => {
  assert.equal(buildReviewBody({ orderItemId: 'x', rating: '4' }).rating, 4);
  assert.equal(buildReviewBody({ orderItemId: 'x', rating: 3.9 }).rating, 3);
  assert.equal(buildReviewBody({ orderItemId: 'x', rating: undefined }).rating, 0);
});

test('isReviewSubmittable requires a 1-5 rating', () => {
  assert.equal(isReviewSubmittable({ rating: 0, title: 'Hi' }).ok, false);
  assert.equal(isReviewSubmittable({ rating: 6, title: 'Hi' }).ok, false);
  assert.equal(isReviewSubmittable({ rating: 1, title: 'Hi' }).ok, true);
  assert.equal(isReviewSubmittable({ rating: 5, title: 'Hi' }).ok, true);
  assert.match(isReviewSubmittable({ rating: 0, title: 'Hi' }).reason, /star rating/i);
});

test('isReviewSubmittable requires at least one non-blank field', () => {
  assert.equal(isReviewSubmittable({ rating: 4, title: '', comment: '  ' }).ok, false);
  assert.equal(isReviewSubmittable({ rating: 4, comment: 'Good.' }).ok, true);
  assert.equal(isReviewSubmittable({ rating: 4, title: 'Good' }).ok, true);
  assert.match(isReviewSubmittable({ rating: 4 }).reason, /few words/i);
});

test('REVIEW_RATING_VALUES is the five whole stars', () => {
  assert.deepEqual([...REVIEW_RATING_VALUES], [1, 2, 3, 4, 5]);
});

test('groupReviewableByOrder buckets items by their order number', () => {
  const items = [
    { orderItemId: 'a', orderNumber: 'ORD-1' },
    { orderItemId: 'b', orderNumber: 'ORD-1' },
    { orderItemId: 'c', orderNumber: 'ORD-2' },
  ];

  const groups = groupReviewableByOrder(items);
  assert.equal(groups.get('ORD-1').length, 2);
  assert.equal(groups.get('ORD-2').length, 1);
  assert.equal(groups.has('ORD-3'), false);
});

test('groupReviewableByOrder is empty and safe for no items', () => {
  assert.equal(groupReviewableByOrder().size, 0);
  assert.equal(groupReviewableByOrder([]).size, 0);
  assert.equal(groupReviewableByOrder([{ orderItemId: 'a' }]).get('').length, 1);
});

test('describeReviewError gives specific copy per known code', () => {
  assert.match(describeReviewError({ code: 'REVIEW_NOT_ELIGIBLE' }), /not yours to review/i);
  assert.match(describeReviewError({ code: 'REVIEW_ALREADY_SUBMITTED' }), /already reviewed/i);
  assert.match(describeReviewError({ code: 'VALIDATION_ERROR' }), /star rating/i);
  assert.match(describeReviewError({ code: 'UNAUTHORIZED' }), /sign in/i);
  assert.match(describeReviewError({ code: 'NETWORK_ERROR' }), /could not reach/i);
});

test('describeReviewError falls back to the message, then to a generic line', () => {
  assert.equal(describeReviewError({ code: 'SOMETHING', message: 'Boom.' }), 'Boom.');
  assert.match(describeReviewError({ code: 'SOMETHING' }), /went wrong/i);
  assert.match(describeReviewError(null), /went wrong/i);
});

test('reviewStatusLabel labels the moderation lifecycle', () => {
  assert.equal(reviewStatusLabel('PENDING'), 'In review');
  assert.equal(reviewStatusLabel('APPROVED'), 'Published');
  assert.equal(reviewStatusLabel('REJECTED'), 'Not published');
  assert.equal(reviewStatusLabel('WAT'), 'In review');
});
