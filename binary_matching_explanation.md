# Earn24 Binary Matching Income Calculation Guide
*(Client-Facing Documentation / Client ko samjhane ke liye simplified guide)*

Yeh document aapke Earn24 application ke **Binary Matching Income** system ko mathematical calculations aur safety limits ke saath aasan bhasha me samjhane ke liye banaya gaya hai.

---

## 📌 Binary Matching Kya Hai?
Jab kisi user ke niche left team aur right team me sale hoti hai aur points (Business Volume - BV) jama hote hain, to system dono sides ke volume ko match karke user ko **Binary Matching Income** deta hai.

---

## ⚙️ Core Rules (Niyam)

1. **Matching Criteria:** Hamesha Left side aur Right side me se **jo side kam (minimum) hogi**, utna volume match kiya jayega.
2. **Carry Forward (Bacha hua volume):** Jis side ka volume extra tha, match hone ke baad bacha hua volume zero nahi hota. Wo agle dino ke liye save (carry-forward) rehta hai.
3. **Tree Level-wise Payout Rates:** 
   *Dhyan edin: Yeh percentage user ke company binary tree me **Global Level (depth)** par depend karta hai. User chahe kitni bhi baar matching kare, uska rate uske tree level ke slab ke hisab se hi rahega:*

| User Ka Tree Level (Depth) | Payout Percentage (% of Matched BV) | Explanation (Puri Details) |
| :--- | :--- | :--- |
| **Level 1 se Level 5** | **5%** | Jab is zone (level 1-5) ka user matching karega, to use matched BV ka 5% commission milega. |
| **Level 6 se Level 10** | **4%** | Jab is zone (level 6-10) ka user matching karega, to use matched BV ka 4% commission milega. |
| **Level 11 se Level 15** | **3%** | Jab is zone (level 11-15) ka user matching karega, to use matched BV ka 3% commission milega. |
| **Level 16 se Level 20** | **2%** | Jab is zone (level 16-20) ka user matching karega, to use matched BV ka 2% commission milega. |
| **Level 21 aur usse deep** | **1%** | Level 21 ya usse niche ka koi bhi user matching karega, to use matched BV ka 1% commission milega. |

4. **Monthly Capping Limit (Safety Net):** Company ko financially safe rakhne ke liye ek user ki maximum binary income **₹5,000 per month** par cap (limit) ki gayi hai. Agar user ka matching commission isse jyada banta hai, to use ₹5,000 hi milenge, aur bacha hua payout skip ho jayega.

---

## 📊 Live Calculation Example (Udaharan)

Maan lijiye **User C** (jo tree me **Level 4** par placed hai) ke left aur right legs me niche diye gaye points (BV) jama hain:
* **Left Leg BV:** 1,000 BV
* **Right Leg BV:** 1,500 BV

Aaiye step-by-step dekhte hain ki system iski calculation kaise karega:

### Step 1: Matching Volume Find Karna
Dono legs me se jo value kam (minimum) hogi, use match kiya jayega.
* Formula: Matched BV = Minimum(Left Leg BV, Right Leg BV)
* Calculation: Matched BV = Minimum(1,000, 1,500) = **1,000 BV**

---

### Step 2: Level-wise Rate Apply Karna
System check karega ki User C company tree me kis depth/level par placed hai.
* Chunki User C **Level 4** par hai (jo ki Level 1-5 ke slab me aata hai), isliye system payout rate **5%** apply karega.
* Formula: Raw Payout = Matched BV * 5%
* Calculation: Raw Payout = 1,000 BV * (5 / 100) = **₹50.00**

*(Yahi agar koi user Level 7 par hota to use **4%** milta, yani ₹40.00)*

---

### Step 3: Monthly Capping Check (Financial Safety Guard)
Paisa wallet me transfer karne se pehle system check karega:
* Kya User C ne current month me abhi tak ₹5,000 se kam binary matching kamai hai?
* **Scenario A (Safe/Paise Milenge):** Agar unki is mahine ki binary income abhi tak ₹2,000 hai, to unhe poora **₹50.00** credit ho jayega (Kyunki ₹2,000 + ₹50 = ₹2,050, jo ki ₹5,000 ke limit se kam hai).
* **Scenario B (Capped/Limit Reach):** Agar unka monthly limit pehle hi reach ho gaya hai (₹5,000 pure ho chuke hain), to unka payout skip/hold ho jayega taaki company ko loss na ho.

---

### Step 4: Legs Update aur Carry Forward Deductions
Paisa distribute hone ke baad, matched volume ko user ke dono legs se minus (deduct) kiya jayega:
* **Naya Left Leg BV:**
  1,000 (Current Left) - 1,000 (Matched) = **0 BV**
* **Naya Right Leg BV:**
  1,500 (Current Right) - 1,000 (Matched) = **500 BV**

> [!NOTE]
> Right side ka bacha hua **500 BV** delete nahi hoga. Yeh carry-forward rahega. Jab bhi future me Left side me koi naya volume (BV) aayega, to is bache hue 500 BV ke saath fir se matching calculate ho jayegi.

---

## 🛡️ Company ke liye iske fayde (Why is this safe?)
1. **No System Collapse:** Kyunki rate deep levels me **1%** par fix ho jata hai, isliye deep network banne par bhi company par payout ka extra load nahi aata.
2. **Capping Guard:** ₹5,000 per user/month ki limit bade leaders ke unlimited matched volumes ko bound rakhti hai, jisse admin panel hamesha profitable rehta hai.
