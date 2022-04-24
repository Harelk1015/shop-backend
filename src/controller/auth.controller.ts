/* eslint-disable operator-linebreak */
import { RequestHandler } from 'express';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import HttpError from '../model/http-error';
import generateAccessToken from '../utils/generateAccessToken';

import { UserDB, IUser } from '../model/user.model';
import { IAuthMiddlewareRequest } from '../model/express/request/auth.request';

export const register: RequestHandler = async (req, res, next) => {
	// Validate Username
	if (req.body.username.length < 6 || req.body.username.length > 26) {
		return next(new HttpError('username is not valid', 400));
	}

	const isEmailValid =
		/(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:(2(5[0-5]|[0-4][0-9])|1[0-9][0-9]|[1-9]?[0-9]))\.){3}(?:(2(5[0-5]|[0-4][0-9])|1[0-9][0-9]|[1-9]?[0-9])|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])/.test(
			req.body.email,
		);

	// Validate Email
	if (!isEmailValid) {
		return next(new HttpError('email is not valid', 400));
	}

	// Validate password
	if (req.body.password.length < 5 || req.body.password.length > 30) {
		return next(new HttpError('Please provide valid password', 400));
	}

	if (req.body.passwordConfirmation.length < 5 || req.body.passwordConfirmation.length > 30) {
		return next(new HttpError('Please provide valid password', 400));
	}

	if (req.body.passwordConfirmation !== req.body.password) {
		return next(new HttpError('Passwords dosent match', 400));
	}

	const [matchingUsername, matchingEmail] = await Promise.all([
		await UserDB.findOne({
			username: req.body.username,
		}),
		await UserDB.findOne({ email: req.body.email }),
	]);

	if (matchingUsername) {
		return next(new HttpError('username already exists', 400));
	}

	if (matchingEmail) {
		return next(new HttpError('email already exists', 400));
	}

	try {
		// From now on, the client is allowed to register
		const hashedPassword = await bcrypt.hash(req.body.password, 8);

		// create user doc
		const newUser: IUser = new UserDB({
			username: req.body.username,
			email: req.body.email,
			password: hashedPassword,
		});

		const newToken = jwt.sign({ id: newUser._id }, process.env.JWT_KEY!, {
			expiresIn: '7 days',
		});

		newUser.tokens = [
			{
				token: newToken,
				_id: new mongoose.Types.ObjectId(),
			},
		];

		await newUser.save();

		res.status(201).send({
			message: 'user created successfuly',
			data: {
				username: req.body.username,
				email: req.body.email,
				token: newToken,
			},
		});
	} catch (err) {
		return next(new HttpError('server error', 500));
	}
};

export const login: RequestHandler = async (req: IAuthMiddlewareRequest, res, next) => {
	// find email match

	try {
		const userByEmail = await UserDB.findOne({ email: req.body.email });

		if (!userByEmail) {
			return next(new HttpError('This email doesnt match any user', 400));
		}
		const compareResults = await bcrypt.compare(req.body.password, userByEmail.password);

		if (!compareResults) {
			return next(new HttpError('password doesnt match', 400));
		}

		// Create new token to insert

		const newToken = generateAccessToken(userByEmail._id);
		const refreshToken = jwt.sign({ _id: userByEmail._id }, process.env.JWT_KEY!);

		if (userByEmail.tokens.length === 5) {
			userByEmail.tokens.pop();
		}

		userByEmail.tokens = [
			{
				token: refreshToken,
				_id: new mongoose.Types.ObjectId(),
			},
			...userByEmail.tokens,
		];

		await userByEmail.save();

		// Create new user object without password inorder to send it back to the client
		const user = userByEmail;
		req.user = user;
		user.password = '';

		res.status(200).send({
			message: 'logged in successfully',
			data: {
				user,
				accessToken: newToken,
				refreshToken,
			},
		});
		return;
	} catch (error) {
		return next(new HttpError(`${error} error`, 500));
	}
};

export const autoLogin: RequestHandler = async (req: IAuthMiddlewareRequest, res, next) => {
	res.status(200).send({ user: req.user });
};
