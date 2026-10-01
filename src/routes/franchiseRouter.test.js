//authRouter.js      |   89.36 |    73.33 |      80 |   93.33 | 44,53,64
const request = require("supertest");
const app = require("../service");
const { Role, DB } = require("../database/database.js");

const testUser = { name: "pizza diner", email: "reg@test.com", password: "a" };
let testUserAuthToken;
let testUserId;
let adminAuthToken;
let testFranchise;

beforeAll(async () => {
  testUser.email = Math.random().toString(36).substring(2, 12) + "@test.com";
  const registerRes = await request(app).post("/api/auth").send(testUser);
  testUserId = registerRes.body.user.id;

  const adminTestUser = await createAdminUser();
  const adminLoginRes = await request(app).put("/api/auth").send(adminTestUser);
  expect(adminLoginRes.status).toBe(200);
  adminAuthToken = adminLoginRes.body.token;
  expectValidJwt(adminAuthToken);

  testFranchise = await DB.createFranchise({
    name: `Test Franchise ${randomName()}`,
    admins: [{ email: testUser.email }],
  });

  const loginRes = await request(app).put("/api/auth").send(testUser);
  expect(loginRes.status).toBe(200);
  testUserAuthToken = loginRes.body.token;
  expectValidJwt(testUserAuthToken);
});

test("get franchises", async () => {
  const franchiseRes = await request(app).get("/api/franchise");

  expect(franchiseRes.status).toBe(200);
  expect(franchiseRes.body).toMatchObject({
    franchises: expect.any(Array),
    more: expect.any(Boolean),
  });
});

test("get user's franchises", async () => {
  const franchiseRes = await request(app).get(`/api/franchise/${testUserId}`).set("Authorization", `Bearer ${testUserAuthToken}`);

  expect(franchiseRes.status).toBe(200);
  expect(franchiseRes.body).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: testFranchise.id, name: testFranchise.name })]),
  );
});

test("create franchise", async () => {
  const franchiseName = `New Franchise ${randomName()}`;
  const franchiseRes = await request(app)
    .post("/api/franchise")
    .set("Authorization", `Bearer ${adminAuthToken}`)
    .send({ name: franchiseName, admins: [{ email: testUser.email }] });

  expect(franchiseRes.status).toBe(200);
  expect(franchiseRes.body).toMatchObject({ id: expect.any(Number), name: franchiseName });
});

test("create franchise - not admin", async () => {
  const franchiseRes = await request(app)
    .post("/api/franchise")
    .set("Authorization", `Bearer ${testUserAuthToken}`)
    .send({ name: `Unauthorized Franchise ${randomName()}`, admins: [] });

  expect(franchiseRes.status).toBe(403);
});

test("delete franchise", async () => {
  const franchise = await DB.createFranchise({ name: `Delete Franchise ${randomName()}`, admins: [] });
  const franchiseRes = await request(app).delete(`/api/franchise/${franchise.id}`);

  expect(franchiseRes.status).toBe(200);
  expect(franchiseRes.body).toMatchObject({ message: "franchise deleted" });
});

test("create store", async () => {
  const storeName = `Test Store ${randomName()}`;
  const storeRes = await request(app)
    .post(`/api/franchise/${testFranchise.id}/store`)
    .set("Authorization", `Bearer ${testUserAuthToken}`)
    .send({ name: storeName });

  expect(storeRes.status).toBe(200);
  expect(storeRes.body).toMatchObject({
    id: expect.any(Number),
    franchiseId: testFranchise.id,
    name: storeName,
  });
});

test("delete store", async () => {
  const store = await DB.createStore(testFranchise.id, { name: `Delete Store ${randomName()}` });
  const storeRes = await request(app)
    .delete(`/api/franchise/${testFranchise.id}/store/${store.id}`)
    .set("Authorization", `Bearer ${testUserAuthToken}`);

  expect(storeRes.status).toBe(200);
  expect(storeRes.body).toMatchObject({ message: "store deleted" });
});

function expectValidJwt(potentialJwt) {
  expect(potentialJwt).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);
}

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

async function createAdminUser() {
  let user = { password: "toomanysecrets", roles: [{ role: Role.Admin }] };
  user.name = randomName();
  user.email = user.name + "@admin.com";

  user = await DB.addUser(user);
  return { ...user, password: "toomanysecrets" };
}
