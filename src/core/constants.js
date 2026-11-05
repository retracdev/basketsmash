import * as THREE from 'three';

// All units are meters / seconds. Court length runs along X, width along Z.
export const COURT = {
  halfL: 14.325,
  halfW: 7.62,
};

export const HOOP_X = 12.755; // |x| of rim center
export const RIM_Y = 3.05;
export const RIM_R = 0.2286;
export const RIM_TUBE = 0.012;
export const BOARD_X = 13.11; // |x| of backboard face
export const BOARD_T = 0.05;
export const BOARD_Y0 = 2.9;
export const BOARD_Y1 = 3.97;
export const BOARD_HALF_W = 0.915;

export const BALL_R = 0.12;
export const THREE_R = 7.24;
export const CORNER_Z = 6.71;
export const KEY_HALF_W = 2.44;
export const FT_DIST = 4.57; // from backboard face

export const GRAVITY = 9.8;
export const PLAYER_GRAVITY = 15;

export const SHOT_CLOCK = 24;

export function hoopPos(side, target = new THREE.Vector3()) {
  return target.set(side * HOOP_X, RIM_Y, 0);
}

export function distToHoop2D(pos, side) {
  const dx = pos.x - side * HOOP_X;
  return Math.hypot(dx, pos.z);
}

export function isThreePoint(pos, side) {
  return Math.abs(pos.z) >= CORNER_Z || distToHoop2D(pos, side) >= THREE_R;
}

export function inBounds(pos, margin = 0) {
  return Math.abs(pos.x) <= COURT.halfL + margin && Math.abs(pos.z) <= COURT.halfW + margin;
}
