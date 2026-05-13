import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import Icon from "@/components/ui/icon";

const HERO_IMAGE =
  "https://cdn.poehali.dev/projects/5f88b64f-b745-4b46-b3ef-4e3ff3a00764/files/56959948-f3c4-4f23-afe0-0c885b81aab6.jpg";

const CATEGORIES = [
  { icon: "Apple", title: "Фрукты и овощи", desc: "Свежий урожай каждый день" },
  { icon: "Beef", title: "Мясо и птица", desc: "Фермерское качество" },
  { icon: "Milk", title: "Молочка", desc: "От проверенных хозяйств" },
  { icon: "Croissant", title: "Хлеб и выпечка", desc: "Свежеиспечённое утром" },
  { icon: "Fish", title: "Рыба и морепродукты", desc: "Поставки с побережья" },
  { icon: "Cookie", title: "Сладости", desc: "Натуральные ингредиенты" },
];

const FEATURES = [
  { icon: "Truck", title: "Доставка за 2 часа", desc: "По городу, бесплатно от 1500 ₽" },
  { icon: "Leaf", title: "Только свежее", desc: "Привозим продукты ежедневно" },
  { icon: "ShieldCheck", title: "Проверенные поставщики", desc: "Сертификаты на каждый товар" },
  { icon: "Wallet", title: "Честные цены", desc: "Без накруток и скрытых платежей" },
];

export default function Shop() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <a href="#" className="flex items-center gap-2 font-semibold">
            <Icon name="ShoppingBasket" size={24} className="text-green-600" />
            <span className="text-lg">Свежий Двор</span>
          </a>
          <nav className="hidden gap-6 text-sm md:flex">
            <a href="#catalog" className="hover:text-green-600">Каталог</a>
            <a href="#about" className="hover:text-green-600">О нас</a>
            <a href="#contacts" className="hover:text-green-600">Контакты</a>
          </nav>
          <Button size="sm" className="bg-green-600 hover:bg-green-700">
            <Icon name="Phone" size={16} className="mr-2" />
            Заказать
          </Button>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="container mx-auto grid gap-10 px-4 py-16 md:grid-cols-2 md:py-24">
          <div className="flex flex-col justify-center">
            <span className="mb-4 inline-flex w-fit items-center gap-2 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800">
              <Icon name="Sparkles" size={14} />
              Магазин фермерских продуктов
            </span>
            <h1 className="mb-4 text-4xl font-bold leading-tight md:text-5xl">
              Свежие продукты <span className="text-green-600">прямо к столу</span>
            </h1>
            <p className="mb-8 text-lg text-muted-foreground">
              Овощи с грядки, мясо от фермера, хлеб из печи. Доставим за 2 часа в любую точку города.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button size="lg" className="bg-green-600 hover:bg-green-700">
                <Icon name="ShoppingCart" size={18} className="mr-2" />
                Смотреть каталог
              </Button>
              <Button size="lg" variant="outline">
                <Icon name="MapPin" size={18} className="mr-2" />
                Где мы находимся
              </Button>
            </div>
          </div>
          <div className="relative">
            <img
              src={HERO_IMAGE}
              alt="Свежие продукты"
              className="aspect-square w-full rounded-2xl object-cover shadow-xl"
            />
            <div className="absolute -bottom-4 -left-4 hidden rounded-xl bg-white p-4 shadow-lg md:block">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                  <Icon name="Star" size={24} className="text-green-600" />
                </div>
                <div>
                  <div className="font-semibold">4.9 / 5</div>
                  <div className="text-xs text-muted-foreground">2 300+ отзывов</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="catalog" className="bg-muted/30 py-16 md:py-24">
        <div className="container mx-auto px-4">
          <div className="mb-12 text-center">
            <h2 className="mb-3 text-3xl font-bold md:text-4xl">Категории товаров</h2>
            <p className="text-muted-foreground">Всё, что нужно для семейного стола</p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {CATEGORIES.map((cat) => (
              <Card key={cat.title} className="group cursor-pointer transition hover:-translate-y-1 hover:shadow-lg">
                <CardContent className="flex items-start gap-4 p-6">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-green-100 text-green-700 transition group-hover:bg-green-600 group-hover:text-white">
                    <Icon name={cat.icon} size={28} />
                  </div>
                  <div>
                    <h3 className="mb-1 font-semibold">{cat.title}</h3>
                    <p className="text-sm text-muted-foreground">{cat.desc}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section id="about" className="py-16 md:py-24">
        <div className="container mx-auto px-4">
          <div className="mb-12 text-center">
            <h2 className="mb-3 text-3xl font-bold md:text-4xl">Почему выбирают нас</h2>
            <p className="text-muted-foreground">Четыре причины делать покупки в Свежем Дворе</p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                  <Icon name={f.icon} size={32} className="text-green-600" />
                </div>
                <h3 className="mb-2 font-semibold">{f.title}</h3>
                <p className="text-sm text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="contacts" className="bg-green-600 py-16 text-white md:py-24">
        <div className="container mx-auto grid gap-10 px-4 md:grid-cols-2">
          <div>
            <h2 className="mb-4 text-3xl font-bold md:text-4xl">Заходите в гости</h2>
            <p className="mb-8 text-green-100">
              Работаем каждый день. Закажите доставку или заберите сами — мы всегда рады гостям.
            </p>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <Icon name="MapPin" size={20} className="mt-1 shrink-0" />
                <div>
                  <div className="font-semibold">Адрес</div>
                  <div className="text-green-100">ул. Зелёная, 12, Москва</div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Icon name="Clock" size={20} className="mt-1 shrink-0" />
                <div>
                  <div className="font-semibold">Часы работы</div>
                  <div className="text-green-100">Ежедневно с 8:00 до 22:00</div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Icon name="Phone" size={20} className="mt-1 shrink-0" />
                <div>
                  <div className="font-semibold">Телефон</div>
                  <a href="tel:+74951234567" className="text-green-100 hover:text-white">
                    +7 (495) 123-45-67
                  </a>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Icon name="Mail" size={20} className="mt-1 shrink-0" />
                <div>
                  <div className="font-semibold">Почта</div>
                  <a href="mailto:hello@svezhdvor.ru" className="text-green-100 hover:text-white">
                    hello@svezhdvor.ru
                  </a>
                </div>
              </div>
            </div>
          </div>
          <div className="rounded-2xl bg-white/10 p-8 backdrop-blur">
            <h3 className="mb-4 text-2xl font-bold">Заказать звонок</h3>
            <p className="mb-6 text-green-100">Перезвоним за 5 минут и поможем оформить заказ</p>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                alert("Спасибо! Мы перезвоним.");
              }}
            >
              <input
                type="text"
                placeholder="Ваше имя"
                required
                className="w-full rounded-lg border border-white/20 bg-white/10 px-4 py-3 text-white placeholder-green-100 outline-none focus:bg-white/20"
              />
              <input
                type="tel"
                placeholder="+7 (___) ___-__-__"
                required
                className="w-full rounded-lg border border-white/20 bg-white/10 px-4 py-3 text-white placeholder-green-100 outline-none focus:bg-white/20"
              />
              <Button type="submit" size="lg" className="w-full bg-white text-green-700 hover:bg-green-50">
                <Icon name="Send" size={18} className="mr-2" />
                Жду звонка
              </Button>
            </form>
          </div>
        </div>
      </section>

      <footer className="border-t bg-background py-8">
        <div className="container mx-auto flex flex-col items-center justify-between gap-4 px-4 text-sm text-muted-foreground md:flex-row">
          <div className="flex items-center gap-2">
            <Icon name="ShoppingBasket" size={18} className="text-green-600" />
            <span>© 2026 Свежий Двор. Все права защищены.</span>
          </div>
          <div className="flex gap-4">
            <a href="#" className="hover:text-green-600"><Icon name="Instagram" size={18} /></a>
            <a href="#" className="hover:text-green-600"><Icon name="Facebook" size={18} /></a>
            <a href="#" className="hover:text-green-600"><Icon name="Send" size={18} /></a>
          </div>
        </div>
      </footer>
    </div>
  );
}
