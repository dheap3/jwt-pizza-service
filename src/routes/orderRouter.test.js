//authRouter.js      |   89.36 |    73.33 |      80 |   93.33 | 44,53,64
const request = require("supertest");
const app = require("../service");
const { Role, DB } = require("../database/database.js");

const testUser = { name: "pizza diner", email: "reg@test.com", password: "a" };
let testUserAuthToken;
let adminAuthToken;

//for all of our new pizza needs (adding to menu)
const newPizza = {
  title: `Saucy ${randomName()}`,
  image: "pizza.png",
  price: 0.02,
  description: "nothing except sauce",
};

beforeAll(async () => {
  //registers an example user
  testUser.email = Math.random().toString(36).substring(2, 12) + "@test.com";
  const registerRes = await request(app).post("/api/auth").send(testUser);
  testUserAuthToken = registerRes.body.token;
  expectValidJwt(testUserAuthToken);
  //logs in the example user
  const loginRes = await request(app).put("/api/auth").send(testUser);
  expect(loginRes.status).toBe(200);
  expectValidJwt(loginRes.body.token);
  //same with admin
  const adminTestUser = await createAdminUser();
  const adminLoginRes = await request(app).put("/api/auth").send(adminTestUser);
  expect(adminLoginRes.status).toBe(200);
  adminAuthToken = adminLoginRes.body.token;
  expectValidJwt(adminAuthToken);
});

test("get orders", async () => {
  const orderRes = await request(app).get("/api/order").set("Authorization", `Bearer ${testUserAuthToken}`);

  expect(orderRes.status).toBe(200);
  expect(orderRes.body).toMatchObject({
    dinerId: expect.any(Number),
    orders: expect.any(Array),
    page: 1,
  });
  for (const order of orderRes.body.orders) {
    expect(order).toMatchObject({
      id: expect.any(Number),
      franchiseId: expect.any(Number),
      storeId: expect.any(Number),
      date: expect.any(String),
      items: expect.any(Array),
    });
  }
});

test("create order", async () => {
  const beforeRes = await request(app).get("/api/order").set("Authorization", `Bearer ${testUserAuthToken}`);
  expect(beforeRes.status).toBe(200);
  const orderCountBefore = beforeRes.body.orders.length;

  const orderRes = await request(app).get("/api/order/menu");
  expect(orderRes.status).toBe(200);
  expect(orderRes.body.length).toBeGreaterThan(0);

  const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({}),
  });

  const newOrder = {
    franchiseId: 1,
    storeId: 1,
    items: [
      {
        menuId: orderRes.body[0].id,
        description: orderRes.body[0].title,
        price: Number(orderRes.body[0].price),
      },
    ],
  };

  try {
    const createRes = await request(app).post("/api/order").set("Authorization", `Bearer ${testUserAuthToken}`).send(newOrder);
    expect(createRes.status).toBe(200);
  } finally {
    fetchMock.mockRestore();
  }

  const afterRes = await request(app).get("/api/order").set("Authorization", `Bearer ${testUserAuthToken}`);
  expect(afterRes.status).toBe(200);
  expect(afterRes.body.orders).toHaveLength(orderCountBefore + 1);
});

test("add to menu - not admin", async () => {
  //without sending a token the response is 401, with a token it will process and say you're not an admin
  const menuRes = await request(app).put("/api/order/menu").set("Authorization", `Bearer ${testUserAuthToken}`).send(newPizza);
  expect(menuRes.status).toBe(403);
});

test("add to menu - admin", async () => {

  const menuRes = await request(app)
    .put("/api/order/menu")
    .set("Authorization", `Bearer ${adminAuthToken}`)
    .send(newPizza);

  expect(menuRes.status).toBe(200);
  const addedPizza = menuRes.body.find((pizza) => pizza.title === newPizza.title);
  expect(addedPizza).toMatchObject({
    id: expect.any(Number),
    title: newPizza.title,
    image: newPizza.image,
    description: newPizza.description,
    price: newPizza.price,
  });
});

test("get menu", async () => {
  await request(app).put("/api/order/menu").set("Authorization", `Bearer ${adminAuthToken}`).send(newPizza);
  //notice it sends as well to make sure there is a pizza there
  const menuRes = await request(app).get("/api/order/menu");
  expect(menuRes.status).toBe(200);
  expect(Array.isArray(menuRes.body)).toBe(true);
  expect(menuRes.body.length).toBeGreaterThan(0);
  const pizza = menuRes.body.find((pizza) => pizza.title === newPizza.title);
  expect(pizza).toMatchObject({
    id: expect.any(Number),
    title: expect.any(String),
    image: expect.any(String),
    price: expect.any(Number),
    description: expect.any(String),
  });
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
