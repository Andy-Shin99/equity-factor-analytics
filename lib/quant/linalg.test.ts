import { describe, expect, it } from "vitest";

import {
  dot,
  identity,
  invert,
  matMul,
  matVecMul,
  SingularMatrixError,
  transpose,
} from "./linalg";

describe("transpose", () => {
  it("flips a rectangular matrix", () => {
    expect(
      transpose([
        [1, 2, 3],
        [4, 5, 6],
      ]),
    ).toEqual([
      [1, 4],
      [2, 5],
      [3, 6],
    ]);
  });

  it("is an involution", () => {
    const a = [
      [1, 2],
      [3, 4],
      [5, 6],
    ];
    expect(transpose(transpose(a))).toEqual(a);
  });

  it("rejects a ragged matrix", () => {
    expect(() => transpose([[1, 2], [3]])).toThrow(/not rectangular/);
  });
});

describe("matMul", () => {
  it("multiplies conformable matrices", () => {
    expect(
      matMul(
        [
          [1, 2],
          [3, 4],
        ],
        [
          [5, 6],
          [7, 8],
        ],
      ),
    ).toEqual([
      [19, 22],
      [43, 50],
    ]);
  });

  it("leaves a matrix unchanged when multiplied by the identity", () => {
    const a = [
      [1.5, -2],
      [0.25, 4],
    ];
    expect(matMul(a, identity(2))).toEqual(a);
  });

  it("rejects a dimension mismatch rather than producing NaN", () => {
    expect(() => matMul([[1, 2]], [[1, 2]])).toThrow(/Dimension mismatch/);
  });
});

describe("matVecMul / dot", () => {
  it("multiplies a matrix by a vector", () => {
    expect(
      matVecMul(
        [
          [1, 2],
          [3, 4],
        ],
        [1, 1],
      ),
    ).toEqual([3, 7]);
  });

  it("computes an inner product", () => {
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32);
  });

  it("rejects mismatched lengths", () => {
    expect(() => dot([1, 2], [1])).toThrow(/Dimension mismatch/);
    expect(() => matVecMul([[1, 2]], [1])).toThrow(/Dimension mismatch/);
  });
});

describe("invert", () => {
  it("inverts a 2x2 matrix", () => {
    const inverse = invert([
      [4, 7],
      [2, 6],
    ]);
    // Closed form: 1/det * [[d, -b], [-c, a]], det = 10.
    expect(inverse[0]?.[0]).toBeCloseTo(0.6, 12);
    expect(inverse[0]?.[1]).toBeCloseTo(-0.7, 12);
    expect(inverse[1]?.[0]).toBeCloseTo(-0.2, 12);
    expect(inverse[1]?.[1]).toBeCloseTo(0.4, 12);
  });

  it("produces the identity when multiplied by the original", () => {
    const a = [
      [2, -1, 0],
      [-1, 2, -1],
      [0, -1, 2],
    ];
    const product = matMul(a, invert(a));
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        expect(product[i]?.[j]).toBeCloseTo(i === j ? 1 : 0, 12);
      }
    }
  });

  it("requires partial pivoting to succeed (zero leading pivot)", () => {
    // Without row swapping this matrix divides by zero on the first column.
    const a = [
      [0, 1],
      [1, 0],
    ];
    expect(invert(a)).toEqual([
      [0, 1],
      [1, 0],
    ]);
  });

  it("throws on a perfectly collinear system", () => {
    // Two identical columns — exactly what duplicated factors produce.
    expect(() =>
      invert([
        [1, 1],
        [1, 1],
      ]),
    ).toThrow(SingularMatrixError);
  });

  it("rejects a non-square matrix", () => {
    expect(() => invert([[1, 2, 3]])).toThrow(/non-square/);
  });
});
